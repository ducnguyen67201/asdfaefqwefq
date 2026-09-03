import { describe, expect, it, vi } from 'vitest';

import { IPC_CHANNELS } from '../../shared/desktop-api';

import { broadcastCompanionState } from './companion-state-broadcast';

function recipient(destroyed = false) {
  return {
    isDestroyed: vi.fn(() => destroyed),
    webContents: { send: vi.fn() },
  };
}

describe('companion state broadcast', () => {
  it('publishes working state to both the desktop pet and action cursor', () => {
    const desktopPet = recipient();
    const actionCursor = recipient();

    broadcastCompanionState('working', [desktopPet, actionCursor]);

    expect(desktopPet.webContents.send).toHaveBeenCalledWith(
      IPC_CHANNELS.companionStateChanged,
      'working',
    );
    expect(actionCursor.webContents.send).toHaveBeenCalledWith(
      IPC_CHANNELS.companionStateChanged,
      'working',
    );
  });

  it('skips absent and destroyed auxiliary surfaces', () => {
    const destroyed = recipient(true);
    const active = recipient();

    broadcastCompanionState('processing', [null, destroyed, active]);

    expect(destroyed.webContents.send).not.toHaveBeenCalled();
    expect(active.webContents.send).toHaveBeenCalledOnce();
  });
});
