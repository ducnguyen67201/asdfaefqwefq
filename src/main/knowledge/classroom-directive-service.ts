import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

import { validateClassroomUrl } from '../../shared/classroom-url-policy';
import {
  ClassroomDirectiveNoticeSchema,
  type ClassroomDirective,
  type ClassroomDirectiveNotice,
} from '../../shared/contracts';

import type { ClassroomSessionService } from './classroom-session-service';
import type { KnowledgeSpaceClient } from './knowledge-space-client';

interface DirectiveDependencies {
  client: Pick<KnowledgeSpaceClient, 'claimDirective' | 'listDirectives'>;
  sessionService: ClassroomSessionService;
  openExternal(url: string): Promise<void>;
  random?: () => number;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
}

export class ClassroomDirectiveService {
  private readonly events = new EventEmitter();
  private readonly random: () => number;
  private readonly setTimer: typeof setTimeout;
  private readonly clearTimer: typeof clearTimeout;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private controller: AbortController | null = null;
  private stopSessionListener: (() => void) | null = null;
  private attemptId: string | null = null;
  private sinceSequence = 0;
  private failures = 0;
  private polling = false;
  private notice: ClassroomDirectiveNotice | null = null;

  constructor(private readonly dependencies: DirectiveDependencies) {
    this.random = dependencies.random ?? Math.random;
    this.setTimer = dependencies.setTimer ?? setTimeout;
    this.clearTimer = dependencies.clearTimer ?? clearTimeout;
  }

  start(): void {
    if (this.stopSessionListener) return;
    this.stopSessionListener = this.dependencies.sessionService.onChange((session) => {
      const nextAttemptId = session && !session.leftAt ? session.attemptId : null;
      if (nextAttemptId === this.attemptId) return;
      this.reset(nextAttemptId);
    });
    this.reset(this.dependencies.sessionService.get()?.attemptId ?? null);
  }

  stop(): void {
    this.stopSessionListener?.();
    this.stopSessionListener = null;
    this.reset(null);
    this.events.removeAllListeners();
  }

  getNotice(): ClassroomDirectiveNotice | null {
    return this.notice ? ClassroomDirectiveNoticeSchema.parse(this.notice) : null;
  }

  onNotice(listener: (notice: ClassroomDirectiveNotice | null) => void): () => void {
    this.events.on('notice', listener);
    return () => this.events.off('notice', listener);
  }

  async open(directive: ClassroomDirective): Promise<void> {
    if (directive.kind !== 'open_url') return;
    const session = this.dependencies.sessionService.get();
    const trusted = this.notice?.directive;
    if (
      !session || session.leftAt || session.run.state !== 'open' ||
      !trusted || trusted.kind !== 'open_url' || trusted.id !== directive.id ||
      trusted.sequence !== directive.sequence || trusted.url !== directive.url ||
      trusted.origin !== directive.origin ||
      this.notice?.status === 'opened' || this.notice?.status === 'dismissed'
    ) {
      throw new Error('This classroom link is not the current trusted directive.');
    }
    const url = validateClassroomUrl(directive.url, directive.origin);
    if (!url) throw new Error('The classroom link is no longer safe to open.');
    try {
      await this.dependencies.openExternal(url.toString());
      this.publish({ directive, status: 'opened' });
    } catch (error) {
      this.publish({ directive, status: 'open_failed' });
      throw error;
    }
  }

  dismiss(directiveId: string): void {
    if (this.notice?.directive.id !== directiveId) return;
    this.publish({ ...this.notice, status: 'dismissed' });
  }

  async pollNow(): Promise<void> {
    if (this.polling || !this.attemptId) return;
    const expectedAttemptId = this.attemptId;
    this.polling = true;
    this.controller = new AbortController();
    try {
      const response = await this.dependencies.client.listDirectives(expectedAttemptId, this.sinceSequence, this.controller.signal);
      if (this.attemptId !== expectedAttemptId) return;
      this.failures = 0;
      this.dependencies.sessionService.updateAttemptState(response.attemptState);
      this.dependencies.sessionService.updateRunState(response.runState);
      if (response.runState === 'closed' || response.runState === 'archived') {
        this.attemptId = null;
        return;
      }
      for (const directive of response.items) {
        if (this.attemptId !== expectedAttemptId) return;
        this.dependencies.sessionService.setCurrentDirective(directive);
        this.publish({ directive, status: 'received' });
        await this.maybeAutoOpen(expectedAttemptId, directive);
        this.sinceSequence = Math.max(this.sinceSequence, directive.sequence);
      }
      this.sinceSequence = Math.max(this.sinceSequence, response.maxSequence);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) this.failures += 1;
    } finally {
      this.controller = null;
      this.polling = false;
      this.schedule();
    }
  }

  private async maybeAutoOpen(attemptId: string, directive: ClassroomDirective): Promise<void> {
    const session = this.dependencies.sessionService.get();
    if (
      directive.kind !== 'open_url' || directive.delivery !== 'auto_eligible' ||
      !session?.autoOpenConsent || session.attemptId !== attemptId || session.run.state !== 'open'
    ) return;
    const url = validateClassroomUrl(directive.url, directive.origin);
    if (!url) return;
    let claim;
    try {
      claim = await this.dependencies.client.claimDirective({ attemptId, directiveId: directive.id, clientId: randomUUID() });
    } catch {
      this.publish({ directive, status: 'open_failed' });
      return;
    }
    const current = this.dependencies.sessionService.get();
    if (!claim.execute || !current?.autoOpenConsent || current.attemptId !== attemptId || current.run.state !== 'open') return;
    const claimedUrl = validateClassroomUrl(claim.url, claim.origin);
    if (!claimedUrl || claimedUrl.origin !== url.origin || claimedUrl.toString() !== url.toString()) return;
    try {
      await this.dependencies.openExternal(claimedUrl.toString());
      this.publish({ directive, status: 'opened' });
    } catch {
      this.publish({ directive, status: 'open_failed' });
    }
  }

  private reset(attemptId: string | null): void {
    this.controller?.abort();
    this.controller = null;
    if (this.timer) this.clearTimer(this.timer);
    this.timer = null;
    this.attemptId = attemptId;
    const currentDirective = this.dependencies.sessionService.get()?.currentDirective;
    this.sinceSequence = attemptId && currentDirective
      ? Math.max(0, currentDirective.sequence - 1)
      : 0;
    this.failures = 0;
    this.polling = false;
    this.notice = null;
    this.events.emit('notice', null);
    if (attemptId) this.schedule(0);
  }

  private schedule(delay?: number): void {
    if (!this.attemptId || this.timer) return;
    const backoff = Math.min(30_000, 3_000 * (2 ** Math.min(this.failures, 3)));
    const wait = delay ?? backoff + Math.floor(this.random() * 2_000);
    this.timer = this.setTimer(() => {
      this.timer = null;
      void this.pollNow();
    }, wait);
  }

  private publish(notice: ClassroomDirectiveNotice): void {
    this.notice = ClassroomDirectiveNoticeSchema.parse(notice);
    this.events.emit('notice', this.getNotice());
  }
}
