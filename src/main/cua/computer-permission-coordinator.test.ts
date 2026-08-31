import { describe, expect, it, vi } from 'vitest';

import type { CuaStatus } from '../../shared/contracts';

import { ComputerPermissionCoordinator } from './computer-permission-coordinator';

function status(overrides: Partial<CuaStatus> = {}): CuaStatus {
  return {
    state: 'permission_required',
    available: false,
    platform: 'darwin',
    permissions: { accessibility: false, screenRecording: false },
    summary: 'Permissions required.',
    nextActions: [],
    ...overrides,
  };
}

describe('ComputerPermissionCoordinator', () => {
  it('opens only the missing operating-system permission settings', async () => {
    const open = vi.fn(async () => undefined);
    const coordinator = new ComputerPermissionCoordinator({
      connectIfPermitted: vi.fn(async () => status()),
      getStatus: vi.fn(async () => status({
        permissions: { accessibility: true, screenRecording: false },
      })),
      openSystemPermissionSettings: open,
    });

    await coordinator.openSettings('task-id');

    expect(open).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledWith('screen_recording');
  });

  it('refreshes a disconnected driver without authorizing an action', async () => {
    const connect = vi.fn(async () => status({ state: 'ready', available: true }));
    const coordinator = new ComputerPermissionCoordinator({
      connectIfPermitted: connect,
      getStatus: vi.fn(async () => status({ state: 'disconnected' })),
      openSystemPermissionSettings: vi.fn(async () => undefined),
    });

    await coordinator.refresh();

    expect(connect).toHaveBeenCalledOnce();
  });
});
