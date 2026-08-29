import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import manifest from '../../../protocol/agent-runtime.v5.manifest.json';

import { ComputerPermissionCoordinator } from './computer-permission-coordinator';

function invocation() {
  return {
    protocolVersion: 5 as const,
    protocolDigest: manifest.protocolDigest,
    toolCatalogDigest: manifest.toolCatalogDigest,
    driverCatalogDigest: null,
    invocationId: randomUUID(),
    runId: randomUUID(),
    runVersion: 4,
    callId: 'call-1',
    toolId: 'computer.observe',
    operation: 'observe',
    permissionInteractionId: null,
    permissionRequirements: [],
    input: { reason: 'Observe the current app.' },
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
}

describe('ComputerPermissionCoordinator', () => {
  it('records a durable wait and resolves the same invocation once ready', async () => {
    let ready = false;
    const decidePermission = vi.fn(async () => ({
      kind: 'ready' as const,
      runVersion: 6,
    }));
    const coordinator = new ComputerPermissionCoordinator({
      backend: {
        decidePermission,
        requestPermissionWait: vi.fn(async (input) => ({
          kind: 'waiting' as const,
          interactionId: input.interactionId,
          runVersion: 5,
        })),
      },
      connectIfPermitted: vi.fn(async () => ({
        state: ready ? 'ready' as const : 'permission_required' as const,
        available: ready,
        platform: 'darwin' as const,
        permissions: { accessibility: ready, screenRecording: ready },
        summary: 'status',
        nextActions: [],
      })),
      getStatus: vi.fn(async () => ({
        state: ready ? 'ready' as const : 'permission_required' as const,
        available: ready,
        platform: 'darwin' as const,
        permissions: { accessibility: ready, screenRecording: ready },
        summary: 'status',
        nextActions: [],
      })),
      openSystemPermissionSettings: vi.fn(async () => undefined),
    });
    const pending = coordinator.requireReady({
      invocation: invocation(),
      requirements: ['accessibility', 'screen_recording'],
      taskId: randomUUID(),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    ready = true;
    await coordinator.refresh();

    await expect(pending).resolves.toEqual({
      outcome: 'granted',
      runVersion: 6,
    });
    expect(decidePermission).toHaveBeenCalledOnce();
    await coordinator.refresh();
    expect(decidePermission).toHaveBeenCalledOnce();
  });

  it('opens only missing settings and does not resolve the wait', async () => {
    const openSystemPermissionSettings = vi.fn(async () => undefined);
    const decidePermission = vi.fn(async () => ({
      kind: 'ready' as const,
      runVersion: 6,
    }));
    const taskId = randomUUID();
    const coordinator = new ComputerPermissionCoordinator({
      backend: {
        decidePermission,
        requestPermissionWait: vi.fn(async (input) => ({
          kind: 'waiting' as const,
          interactionId: input.interactionId,
          runVersion: 5,
        })),
      },
      connectIfPermitted: vi.fn(),
      getStatus: vi.fn(async () => ({
        state: 'permission_required' as const,
        available: false,
        platform: 'darwin' as const,
        permissions: { accessibility: true, screenRecording: false },
        summary: 'status',
        nextActions: [],
      })),
      openSystemPermissionSettings,
    });
    const pending = coordinator.requireReady({
      invocation: invocation(),
      requirements: ['accessibility', 'screen_recording'],
      taskId,
    });
    void pending.catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await coordinator.openSettings(taskId);

    expect(openSystemPermissionSettings).toHaveBeenCalledWith(
      'screen_recording',
    );
    expect(decidePermission).not.toHaveBeenCalled();
    coordinator.dispose();
  });
});
