import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

import {
  BroadcastDraftActionSchema,
  BroadcastDraftLookupSchema,
  ClassroomBroadcastDraftSchema,
  type BroadcastDraftProjection,
  type ClassroomBroadcastDraft,
  type PrepareClassroomBroadcast,
  type TeacherClassroomBinding,
} from '../../shared/contracts';
import type { EncryptedAgentStateStore } from '../agent-runtime/encrypted-agent-state-store';

import {
  classroomBroadcastDigest,
  resolveClassroomBroadcast,
} from './classroom-assignment-resolver';
import { assertBroadcastTransition } from './classroom-broadcast-policy';
import {
  KnowledgeSpaceRequestError,
  type KnowledgeSpaceClient,
} from './knowledge-space-client';
import type { TeacherClassroomContextService } from './teacher-classroom-context-service';

export class ClassroomBroadcastDraftService {
  private readonly events = new EventEmitter();
  private readonly operations = new Map<
    string,
    Promise<ClassroomBroadcastDraft>
  >();
  private readonly observedTasks = new Map<string, string>();
  constructor(
    private readonly options: {
      state: EncryptedAgentStateStore;
      context: TeacherClassroomContextService;
      client: Pick<
        KnowledgeSpaceClient,
        'commitClassroomBroadcast' | 'lookupClassroomBroadcast'
      >;
      owner: () => Promise<string>;
      now?: () => number;
    },
  ) {
    options.context.onChange(() => {
      for (const [taskId, owner] of this.observedTasks) {
        void options.state
          .updateClassroomState(owner, taskId, (current) => ({
            ...current,
            broadcastDrafts: current.broadcastDrafts.map((draft) =>
              draft.state === 'prepared'
                ? { ...draft, state: 'stale', revision: draft.revision + 1 }
                : draft,
            ),
          }))
          .then(async () => {
            if ((await options.owner()) === owner) await this.emit(taskId);
          })
          .catch(() => undefined);
      }
    });
  }
  private now(): number {
    return this.options.now?.() ?? Date.now();
  }
  async list(taskId: string): Promise<BroadcastDraftProjection> {
    const owner = await this.options.owner();
    const state = await this.options.state.readOwnedThread(owner, taskId);
    this.observedTasks.set(taskId, owner);
    return {
      taskId,
      revision: state.broadcastRevision,
      drafts: state.broadcastDrafts,
    };
  }
  async prepare(
    taskId: string,
    callId: string,
    binding: TeacherClassroomBinding,
    input: PrepareClassroomBroadcast,
    signal?: AbortSignal,
  ) {
    const context = await this.options.context.verify(binding);
    signal?.throwIfAborted();
    if (input.studentAction === 'explain' && !context.guidanceAvailable)
      throw new Error(
        'Student explanations are not supported by this server yet.',
      );
    const resolution = resolveClassroomBroadcast(input, context.assignments);
    if (resolution.status !== 'resolved') return resolution;
    const payloadDigest = classroomBroadcastDigest(resolution.payload);
    const state = await this.options.state.updateClassroomState(
      binding.ownerId,
      taskId,
      (current) => {
        const existing = current.broadcastDrafts.find(
          (d) => d.sourceCallId === callId,
        );
        if (existing) {
          if (existing.payloadDigest !== payloadDigest)
            throw new Error(
              'Broadcast preparation key conflicts with an existing draft.',
            );
          return current;
        }
        signal?.throwIfAborted();
        const selected = this.options.context.get()?.binding;
        if (
          !selected ||
          selected.sessionId !== binding.sessionId ||
          selected.ownerId !== binding.ownerId
        )
          throw new Error('The selected class changed.');
        let drafts = current.broadcastDrafts.map((d) =>
          d.state === 'prepared'
            ? { ...d, state: 'stale' as const, revision: d.revision + 1 }
            : d,
        );
        if (drafts.length >= 20) {
          const prune = drafts.findIndex((d) =>
            ['sent', 'cancelled', 'expired', 'stale', 'failed'].includes(
              d.state,
            ),
          );
          if (prune < 0)
            throw new Error(
              'Resolve pending broadcast outcomes before preparing another draft.',
            );
          drafts = drafts.filter((_, i) => i !== prune);
        }
        const draft = ClassroomBroadcastDraftSchema.parse({
          draftId: randomUUID(),
          taskId,
          sourceCallId: callId,
          binding,
          revision: 1,
          payloadDigest,
          audience: 'session_participants',
          payload: resolution.payload,
          createdAt: new Date(this.now()).toISOString(),
          expiresAt: new Date(this.now() + 600_000).toISOString(),
          state: 'prepared',
        });
        return { ...current, broadcastDrafts: [...drafts, draft] };
      },
    );
    await this.emit(taskId);
    const draft = state.broadcastDrafts.find((d) => d.sourceCallId === callId)!;
    if (draft.state !== 'prepared')
      return {
        status: 'existing',
        draftId: draft.draftId,
        state: draft.state,
        message:
          'This preparation call already has a saved outcome. Review its existing card.',
      };
    return {
      status: 'prepared',
      draftId: draft.draftId,
      taskId,
      revision: draft.revision,
      payload: draft.payload,
      audience: draft.audience,
      message:
        'Draft ready. The teacher must click Broadcast to class to send it.',
    };
  }
  async confirm(raw: unknown): Promise<ClassroomBroadcastDraft> {
    const input = BroadcastDraftActionSchema.parse(raw);
    const key = `${await this.options.owner()}:${input.draftId}`;
    const active = this.operations.get(key);
    if (active) return active;
    const operation = this.commit(input).finally(() =>
      this.operations.delete(key),
    );
    this.operations.set(key, operation);
    return operation;
  }
  private async commit(input: {
    taskId: string;
    draftId: string;
    revision: number;
  }): Promise<ClassroomBroadcastDraft> {
    const owner = await this.options.owner();
    let draft = await this.get(input.taskId, input.draftId);
    if (['sent', 'sending', 'unknown'].includes(draft.state)) return draft;
    if (draft.state !== 'prepared' || draft.revision !== input.revision)
      throw new Error('This preview has changed. Review the current preview.');
    const selected = this.options.context.get();
    if (
      !selected ||
      selected.binding.sessionId !== draft.binding.sessionId ||
      selected.binding.spaceId !== draft.binding.spaceId
    )
      return this.transition(
        owner,
        draft,
        'stale',
        'Select the original session and prepare a new preview.',
      );
    if (this.now() >= Date.parse(draft.expiresAt))
      return this.transition(
        owner,
        draft,
        'expired',
        'Prepare a fresh preview.',
      );
    await this.options.context.resolve(selected.selectionId);
    if ((await this.options.owner()) !== owner)
      throw new Error('Account changed.');
    draft = await this.transition(owner, draft, 'sending');
    try {
      const receipt = await this.options.client.commitClassroomBroadcast(
        draft.binding.spaceId,
        draft.binding.sessionId,
        draft.draftId,
        draft.payload,
      );
      if (
        receipt.clientId !== draft.draftId ||
        receipt.payloadDigest !== draft.payloadDigest ||
        classroomBroadcastDigest(receipt.broadcast.payload) !==
          draft.payloadDigest
      )
        throw new Error('Broadcast receipt does not match this preview.');
      return await this.transition(owner, draft, 'sent', null, receipt);
    } catch (error) {
      const rejected =
        error instanceof KnowledgeSpaceRequestError &&
        error.status >= 400 &&
        error.status < 500 &&
        error.status !== 408;
      return this.transition(
        owner,
        draft,
        rejected ? 'failed' : 'unknown',
        rejected
          ? error.message
          : 'The save outcome is unknown. Check the receipt; do not send another copy.',
      );
    }
  }
  async cancel(raw: unknown): Promise<ClassroomBroadcastDraft> {
    const input = BroadcastDraftActionSchema.parse(raw);
    const draft = await this.get(input.taskId, input.draftId);
    if (draft.state !== 'prepared' || draft.revision !== input.revision)
      throw new Error('Only the current unsent preview can be cancelled.');
    return this.transition(await this.options.owner(), draft, 'cancelled');
  }
  async cancelTask(taskId: string): Promise<void> {
    const owner = await this.options.owner();
    await this.options.state.updateClassroomState(owner, taskId, (current) => ({
      ...current,
      broadcastDrafts: current.broadcastDrafts.map((d) =>
        d.state === 'prepared'
          ? { ...d, state: 'cancelled', revision: d.revision + 1 }
          : d,
      ),
    }));
    await this.emit(taskId);
  }
  async reconcile(raw: unknown): Promise<ClassroomBroadcastDraft> {
    const input = BroadcastDraftLookupSchema.parse(raw);
    const draft = await this.get(input.taskId, input.draftId);
    if (!['sending', 'unknown'].includes(draft.state)) return draft;
    const owner = await this.options.owner();
    const { receipt } = await this.options.client.lookupClassroomBroadcast(
      draft.binding.spaceId,
      draft.binding.sessionId,
      draft.draftId,
    );
    if (
      receipt &&
      receipt.clientId === draft.draftId &&
      receipt.payloadDigest === draft.payloadDigest &&
      classroomBroadcastDigest(receipt.broadcast.payload) ===
        draft.payloadDigest
    )
      return this.transition(owner, draft, 'sent', null, receipt);
    return this.transition(
      owner,
      draft,
      'unknown',
      'No receipt is available yet. The original save may still finish.',
    );
  }
  onChange(
    listener: (projection: BroadcastDraftProjection) => void,
  ): () => void {
    this.events.on('change', listener);
    return () => this.events.off('change', listener);
  }
  private async get(
    taskId: string,
    draftId: string,
  ): Promise<ClassroomBroadcastDraft> {
    const { drafts } = await this.list(taskId);
    const draft = drafts.find((d) => d.draftId === draftId);
    if (!draft) throw new Error('Broadcast preview not found.');
    return draft;
  }
  private async transition(
    owner: string,
    draft: ClassroomBroadcastDraft,
    state: ClassroomBroadcastDraft['state'],
    error: string | null = null,
    receipt: ClassroomBroadcastDraft['receipt'] = null,
  ): Promise<ClassroomBroadcastDraft> {
    const thread = await this.options.state.updateClassroomState(
      owner,
      draft.taskId,
      (current) => {
        const found = current.broadcastDrafts.find(
          (d) => d.draftId === draft.draftId,
        );
        if (!found || found.revision !== draft.revision)
          throw new Error('Broadcast preview changed.');
        assertBroadcastTransition(found.state, state);
        if (
          state === 'sending' &&
          this.options.context.get()?.binding.sessionId !==
            draft.binding.sessionId
        )
          throw new Error('The selected class changed.');
        return {
          ...current,
          broadcastDrafts: current.broadcastDrafts.map((d) =>
            d.draftId === draft.draftId
              ? {
                  ...d,
                  state,
                  error,
                  receipt: receipt ?? d.receipt,
                  revision: d.revision + 1,
                }
              : d,
          ),
        };
      },
    );
    try {
      if ((await this.options.owner()) === owner) await this.emit(draft.taskId);
    } catch {
      /* Preserve the saved outcome across sign-out. */
    }
    return thread.broadcastDrafts.find((d) => d.draftId === draft.draftId)!;
  }
  private async emit(taskId: string): Promise<void> {
    this.events.emit('change', await this.list(taskId));
  }
}
