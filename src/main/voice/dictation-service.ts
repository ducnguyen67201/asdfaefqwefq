import type {
  BeginDictationResult,
  DictationCommitResult,
} from '../../shared/contracts';
import type { CuaWindow } from '../cua/cua-semantic-contracts';
import type {
  CuaDictationDeliveryResult,
  CuaDictationStatus,
} from '../cua/cua-service';
import {
  sameWindowIdentity,
  selectFrontmostExternalWindow,
  type CuaWindowIdentity,
} from '../cua/cua-window-selection';

interface DictationCuaAdapter {
  connectForDictation(): Promise<CuaDictationStatus>;
  endDictationSession(sessionId: string): Promise<void>;
  listDictationWindows(): Promise<CuaWindow[]>;
  startDictationSession(sessionId: string): Promise<void>;
  typeDictationText(input: {
    processId: number;
    sessionId: string;
    text: string;
    windowId: number;
  }): Promise<CuaDictationDeliveryResult>;
}

interface ActiveDictationTurn {
  sessionId: string;
  state: 'ready' | 'committing';
  target: CuaWindowIdentity;
  targetApplication: string;
  turnId: string;
}

export interface DictationServiceOptions {
  cua: DictationCuaAdapter;
  logger?: Pick<Console, 'info' | 'warn'>;
  now?: () => number;
  ownProcessId?: number;
}

const MAX_CONSUMED_TURNS = 100;

export class DictationService {
  private active: ActiveDictationTurn | null = null;
  private preparingTurnId: string | null = null;
  private readonly consumedTurns = new Set<string>();
  private readonly consumedTurnOrder: string[] = [];
  private readonly cua: DictationCuaAdapter;
  private readonly logger: Pick<Console, 'info' | 'warn'>;
  private lifecycleGeneration = 0;
  private readonly now: () => number;
  private readonly ownProcessId: number;

  constructor(options: DictationServiceOptions) {
    this.cua = options.cua;
    this.logger = options.logger ?? console;
    this.now = options.now ?? Date.now;
    this.ownProcessId = options.ownProcessId ?? process.pid;
  }

  async begin(turnId: string): Promise<BeginDictationResult> {
    if (this.active?.turnId === turnId && this.active.state === 'ready') {
      return {
        status: 'ready',
        targetApplication: this.active.targetApplication,
        turnId,
      };
    }
    if (this.active || this.preparingTurnId) {
      return {
        reason: 'busy',
        status: 'busy',
        summary: 'Finish the current dictation before starting another.',
        turnId,
      };
    }
    if (this.consumedTurns.has(turnId)) {
      return {
        reason: 'busy',
        status: 'busy',
        summary: 'This dictation turn has already finished.',
        turnId,
      };
    }

    this.preparingTurnId = turnId;
    const generation = this.lifecycleGeneration;
    const startedAt = this.now();
    const sessionId = `dictation:${turnId}`;
    let sessionStarted = false;
    try {
      const connection = await this.cua.connectForDictation();
      if (!this.isCurrentPreparation(turnId, generation)) {
        return {
          reason: 'driver',
          status: 'unavailable',
          summary: 'This dictation preparation was cancelled.',
          turnId,
        };
      }
      if (connection.state !== 'ready') {
        this.log('prepare.completed', startedAt, {
          disposition: connection.state,
          reason: connection.reason ?? 'driver',
        });
        if (connection.state === 'permission_required') {
          return {
            reason: 'accessibility',
            status: 'permission_required',
            summary: connection.summary,
            turnId,
          };
        }
        return {
          reason:
            connection.reason === 'platform'
              ? 'platform'
              : 'driver',
          status: 'unavailable',
          summary: connection.summary,
          turnId,
        };
      }
      await this.cua.startDictationSession(sessionId);
      sessionStarted = true;
      if (!this.isCurrentPreparation(turnId, generation)) {
        return {
          reason: 'driver',
          status: 'unavailable',
          summary: 'This dictation preparation was cancelled.',
          turnId,
        };
      }
      const target = selectFrontmostExternalWindow(
        await this.cua.listDictationWindows(),
        this.ownProcessId,
      );
      if (!this.isCurrentPreparation(turnId, generation)) {
        return {
          reason: 'driver',
          status: 'unavailable',
          summary: 'This dictation preparation was cancelled.',
          turnId,
        };
      }
      if (!target) {
        this.log('prepare.completed', startedAt, {
          disposition: 'unavailable',
          reason: 'no_target',
        });
        return {
          reason: 'no_target',
          status: 'unavailable',
          summary: 'Tro could not identify one frontmost application for dictation.',
          turnId,
        };
      }
      const targetApplication = target.app_name.trim().slice(0, 120) || 'Application';
      this.active = {
        sessionId,
        state: 'ready',
        target: { processId: target.pid, windowId: target.window_id },
        targetApplication,
        turnId,
      };
      this.log('prepare.completed', startedAt, { disposition: 'ready' });
      return { status: 'ready', targetApplication, turnId };
    } catch (error) {
      this.logger.warn('[voice:dictation] prepare.failed', {
        error: error instanceof Error ? error.name : 'UnknownError',
      });
      return {
        reason: 'driver',
        status: 'unavailable',
        summary: 'Tro could not prepare system-wide dictation.',
        turnId,
      };
    } finally {
      if (this.preparingTurnId === turnId) this.preparingTurnId = null;
      if (sessionStarted && !this.active) {
        await this.cua.endDictationSession(sessionId).catch(() => undefined);
      }
    }
  }

  async commit(turnId: string, text: string): Promise<DictationCommitResult> {
    const active = this.active;
    if (
      !active ||
      active.turnId !== turnId ||
      active.state !== 'ready' ||
      this.consumedTurns.has(turnId)
    ) {
      return {
        disposition: 'not_inserted',
        reason: 'already_consumed',
        summary: 'This dictation turn is no longer available.',
      };
    }

    active.state = 'committing';
    this.rememberConsumed(turnId);
    const generation = this.lifecycleGeneration;
    const startedAt = this.now();
    let deliveryStarted = false;
    try {
      const current = selectFrontmostExternalWindow(
        await this.cua.listDictationWindows(),
        this.ownProcessId,
      );
      if (
        this.lifecycleGeneration !== generation ||
        this.active !== active
      ) {
        return {
          disposition: 'not_inserted',
          reason: 'cancelled',
          summary: 'This dictation turn was cancelled before insertion.',
          targetApplication: active.targetApplication,
        };
      }
      if (
        !current ||
        !sameWindowIdentity(active.target, {
          processId: current.pid,
          windowId: current.window_id,
        })
      ) {
        const result: DictationCommitResult = {
          disposition: 'not_inserted',
          reason: 'target_changed',
          summary: 'The dictation target changed, so Tro did not insert the text.',
          targetApplication: active.targetApplication,
        };
        this.log('commit.completed', startedAt, {
          characters: text.length,
          disposition: result.disposition,
          reason: result.reason,
        });
        return result;
      }

      deliveryStarted = true;
      const delivery = await this.cua.typeDictationText({
        processId: active.target.processId,
        sessionId: active.sessionId,
        text,
        windowId: active.target.windowId,
      });
      if (
        this.lifecycleGeneration !== generation ||
        this.active !== active
      ) {
        const result: DictationCommitResult = {
          disposition: 'delivery_unverified',
          reason: 'cancelled',
          summary:
            'Dictation was cancelled while insertion was in progress, so delivery could not be verified.',
          targetApplication: active.targetApplication,
        };
        this.log('commit.completed', startedAt, {
          characters: text.length,
          disposition: result.disposition,
          effect: delivery.effect,
          reason: result.reason,
        });
        return result;
      }
      const result: DictationCommitResult =
        delivery.effect === 'confirmed'
          ? {
              disposition: 'inserted',
              reason: 'confirmed',
              summary: 'Tro inserted the dictated text.',
              targetApplication: active.targetApplication,
            }
          : delivery.effect === 'refused_before_execution'
            ? {
                disposition: 'not_inserted',
                reason: 'driver_refused',
                summary: 'The target refused dictated text before insertion.',
                targetApplication: active.targetApplication,
              }
            : {
                disposition: 'delivery_unverified',
                reason: 'driver_error',
                summary: 'Tro could not confirm whether the dictated text was inserted.',
                targetApplication: active.targetApplication,
              };
      this.log('commit.completed', startedAt, {
        characters: text.length,
        disposition: result.disposition,
        effect: delivery.effect,
        reason: result.reason,
      });
      return result;
    } catch (error) {
      this.logger.warn('[voice:dictation] commit.failed', {
        deliveryStarted,
        error: error instanceof Error ? error.name : 'UnknownError',
      });
      return {
        disposition: deliveryStarted ? 'delivery_unverified' : 'not_inserted',
        reason: 'driver_error',
        summary: deliveryStarted
          ? 'Tro could not confirm whether the dictated text was inserted.'
          : 'Tro could not insert the dictated text.',
        targetApplication: active.targetApplication,
      };
    } finally {
      if (this.active === active) {
        this.active = null;
        await this.cua
          .endDictationSession(active.sessionId)
          .catch(() => undefined);
      }
    }
  }

  async cancel(turnId: string): Promise<void> {
    if (this.preparingTurnId === turnId) {
      this.preparingTurnId = null;
      this.lifecycleGeneration += 1;
    }
    const active = this.active;
    if (!active || active.turnId !== turnId) {
      this.rememberConsumed(turnId);
      return;
    }
    this.active = null;
    this.lifecycleGeneration += 1;
    this.rememberConsumed(turnId);
    await this.cua.endDictationSession(active.sessionId).catch(() => undefined);
  }

  async shutdown(): Promise<void> {
    this.lifecycleGeneration += 1;
    const active = this.active;
    this.active = null;
    this.preparingTurnId = null;
    if (active) {
      await this.cua.endDictationSession(active.sessionId).catch(() => undefined);
    }
    this.consumedTurns.clear();
    this.consumedTurnOrder.length = 0;
  }

  private rememberConsumed(turnId: string): void {
    if (this.consumedTurns.has(turnId)) return;
    this.consumedTurns.add(turnId);
    this.consumedTurnOrder.push(turnId);
    if (this.consumedTurnOrder.length <= MAX_CONSUMED_TURNS) return;
    const oldest = this.consumedTurnOrder.shift();
    if (oldest) this.consumedTurns.delete(oldest);
  }

  private isCurrentPreparation(turnId: string, generation: number): boolean {
    return (
      this.lifecycleGeneration === generation &&
      this.preparingTurnId === turnId
    );
  }

  private log(
    event: string,
    startedAt: number,
    properties: Record<string, boolean | number | string>,
  ): void {
    this.logger.info(
      `[voice:dictation] ${event}`,
      JSON.stringify({
        ...properties,
        durationMs: Math.max(0, this.now() - startedAt),
      }),
    );
  }
}
