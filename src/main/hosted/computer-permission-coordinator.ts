import { randomUUID } from 'node:crypto';

import type {
  ComputerPermissionV4,
  DesktopInvocationV4,
} from '../../shared/agent-runtime-protocol';
import type { CuaStatus } from '../../shared/contracts';

type ComputerPermission = ComputerPermissionV4;
type PermissionOutcome = 'granted' | 'continue_without_computer';
export interface PermissionResolution {
  outcome: PermissionOutcome;
  runVersion: number;
}

interface PermissionBackend {
  decidePermission(input: {
    decision: PermissionOutcome;
    expectedRunVersion: number;
    interactionId: string;
    invocationId: string;
  }): Promise<{ kind: 'ready' | 'committed'; runVersion: number }>;
  requestPermissionWait(input: {
    expectedRunVersion: number;
    interactionId: string;
    invocationId: string;
    requiredPermissions: ComputerPermission[];
  }): Promise<{ interactionId: string; kind: 'waiting'; runVersion: number }>;
}

interface PendingPermission {
  interactionId: string;
  invocationId: string;
  promise: Promise<PermissionResolution>;
  reject(error: Error): void;
  requirements: ComputerPermission[];
  resolve(resolution: PermissionResolution): void;
  resolving: boolean;
  runId: string;
  runVersion: number;
  taskId: string;
}

export interface ComputerPermissionCoordinatorOptions {
  backend: PermissionBackend;
  connectIfPermitted(): Promise<CuaStatus>;
  getStatus(): Promise<CuaStatus>;
  openSystemPermissionSettings(permission: ComputerPermission): Promise<void>;
}

export class ComputerPermissionCoordinator {
  private readonly pendingByInvocation = new Map<string, PendingPermission>();

  constructor(private readonly options: ComputerPermissionCoordinatorOptions) {}

  async requireReady(input: {
    invocation: DesktopInvocationV4;
    requirements: readonly ComputerPermission[];
    taskId: string;
  }): Promise<PermissionResolution> {
    if (input.requirements.length === 0) {
      return { outcome: 'granted', runVersion: input.invocation.runVersion };
    }
    const status = await this.readyStatus();
    if (status.state === 'ready' && status.available) {
      return { outcome: 'granted', runVersion: input.invocation.runVersion };
    }

    const existing = this.pendingByInvocation.get(input.invocation.invocationId);
    if (existing) return existing.promise;

    const interactionId =
      input.invocation.permissionInteractionId ?? randomUUID();
    const wait = await this.options.backend.requestPermissionWait({
      invocationId: input.invocation.invocationId,
      interactionId,
      expectedRunVersion: input.invocation.runVersion,
      requiredPermissions: [...input.requirements],
    });

    let resolvePromise!: (resolution: PermissionResolution) => void;
    let rejectPromise!: (error: Error) => void;
    const promise = new Promise<PermissionResolution>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    const pending: PendingPermission = {
      interactionId,
      invocationId: input.invocation.invocationId,
      promise,
      reject: rejectPromise,
      requirements: [...input.requirements],
      resolve: resolvePromise,
      resolving: false,
      runId: input.invocation.runId,
      runVersion: wait.runVersion,
      taskId: input.taskId,
    };
    this.pendingByInvocation.set(pending.invocationId, pending);
    return promise;
  }

  async refresh(): Promise<void> {
    if (this.pendingByInvocation.size === 0) return;
    const status = await this.readyStatus();
    if (status.state !== 'ready' || !status.available) return;
    await Promise.all(
      [...this.pendingByInvocation.values()].map((pending) =>
        this.resolvePending(pending, 'granted'),
      ),
    );
  }

  async openSettings(taskId: string): Promise<void> {
    const pending = this.pendingForTask(taskId);
    const status = await this.options.getStatus();
    for (const permission of pending.requirements) {
      const granted =
        permission === 'accessibility'
          ? status.permissions?.accessibility
          : status.permissions?.screenRecording;
      if (!granted) {
        await this.options.openSystemPermissionSettings(permission);
      }
    }
  }

  async continueWithout(taskId: string): Promise<void> {
    await this.resolvePending(
      this.pendingForTask(taskId),
      'continue_without_computer',
    );
  }

  dispose(): void {
    for (const pending of this.pendingByInvocation.values()) {
      pending.reject(new Error('Computer-permission wait was interrupted.'));
    }
    this.pendingByInvocation.clear();
  }

  private pendingForTask(taskId: string): PendingPermission {
    const pending = [...this.pendingByInvocation.values()].find(
      (candidate) => candidate.taskId === taskId,
    );
    if (!pending) {
      throw new Error('No computer-permission request is waiting for this task.');
    }
    return pending;
  }

  private async readyStatus(): Promise<CuaStatus> {
    const status = await this.options.getStatus();
    if (status.state !== 'disconnected') return status;
    return this.options.connectIfPermitted();
  }

  private async resolvePending(
    pending: PendingPermission,
    decision: PermissionOutcome,
  ): Promise<void> {
    if (pending.resolving) return;
    pending.resolving = true;
    try {
      const result = await this.options.backend.decidePermission({
        invocationId: pending.invocationId,
        interactionId: pending.interactionId,
        expectedRunVersion: pending.runVersion,
        decision,
      });
      this.pendingByInvocation.delete(pending.invocationId);
      pending.resolve({ outcome: decision, runVersion: result.runVersion });
    } catch (error) {
      pending.resolving = false;
      throw error;
    }
  }
}
