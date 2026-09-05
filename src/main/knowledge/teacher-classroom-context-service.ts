import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

import {
  TeacherClassroomBindingSchema,
  TeacherClassroomSelectionSchema,
  type TeacherClassroomBinding,
  type TeacherClassroomSelection,
} from '../../shared/contracts';

import type { KnowledgeSpaceClient } from './knowledge-space-client';

export class TeacherClassroomContextService {
  private selection: TeacherClassroomSelection | null = null;
  private generation = 0;
  private readonly events = new EventEmitter();
  constructor(
    private readonly client: Pick<
      KnowledgeSpaceClient,
      'capabilities' | 'teacherClassroomContext'
    >,
    private readonly owner: () => Promise<string>,
  ) {}
  get(): TeacherClassroomSelection | null {
    return this.selection
      ? TeacherClassroomSelectionSchema.parse(this.selection)
      : null;
  }
  async select(
    spaceId: string,
    sessionId: string,
  ): Promise<TeacherClassroomSelection> {
    const generation = ++this.generation;
    this.selection = null;
    this.events.emit('change', null);
    const ownerId = await this.owner();
    const context = await this.verify({ ownerId, spaceId, sessionId });
    if (generation !== this.generation || (await this.owner()) !== ownerId)
      throw new Error('Class selection changed. Select the session again.');
    this.selection = TeacherClassroomSelectionSchema.parse({
      selectionId: randomUUID(),
      binding: context.binding,
    });
    this.events.emit('change', this.get());
    return this.get()!;
  }
  clear(selectionId?: string): void {
    if (selectionId && this.selection?.selectionId !== selectionId) return;
    ++this.generation;
    this.selection = null;
    this.events.emit('change', null);
  }
  async resolve(selectionId: string): Promise<TeacherClassroomBinding> {
    const current = this.get();
    if (!current || current.selectionId !== selectionId)
      throw new Error('Select the live teacher session again.');
    const result = await this.verify(current.binding);
    if (this.selection?.selectionId !== selectionId)
      throw new Error('Class selection changed. Please submit again.');
    return result.binding;
  }
  async verify(
    binding: Pick<TeacherClassroomBinding, 'ownerId' | 'spaceId' | 'sessionId'>,
  ) {
    if ((await this.owner()) !== binding.ownerId)
      throw new Error('Classroom owner changed. Sign in again.');
    const capabilities = await this.client.capabilities();
    if (
      !capabilities.knowledgeSpaces.enabled ||
      !capabilities.classroomBroadcasts
    )
      throw new Error(
        'This server does not support classroom voice broadcasts yet.',
      );
    const context = await this.client.teacherClassroomContext(
      binding.spaceId,
      binding.sessionId,
    );
    if (context.sessionState !== 'open')
      throw new Error('Open a live class session first.');
    if (
      context.binding.spaceId !== binding.spaceId ||
      context.binding.sessionId !== binding.sessionId ||
      (await this.owner()) !== binding.ownerId
    )
      throw new Error('Classroom authority changed.');
    return {
      ...context,
      guidanceAvailable: Boolean(capabilities.classroomGuidance),
      binding: TeacherClassroomBindingSchema.parse({
        ...context.binding,
        ownerId: binding.ownerId,
      }),
    };
  }
  onChange(
    listener: (selection: TeacherClassroomSelection | null) => void,
  ): () => void {
    this.events.on('change', listener);
    return () => this.events.off('change', listener);
  }
}
