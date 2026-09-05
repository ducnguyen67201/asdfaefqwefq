import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';

import { describe, expect, it, vi } from 'vitest';

import { CLASSROOM_BROADCAST_CHANNELS as channels } from '../../shared/classroom-desktop-api';

import {
  registerClassroomBroadcastIpc,
  type ClassroomBroadcastFeatures,
} from './register-classroom-broadcast-ipc';
const handlers = vi.hoisted(
  () => new Map<string, (event: unknown, input: unknown) => Promise<unknown>>(),
);
vi.mock('electron', () => ({
  ipcMain: {
    handle: (
      channel: string,
      handler: (event: unknown, input: unknown) => Promise<unknown>,
    ) => handlers.set(channel, handler),
    removeHandler: (channel: string) => handlers.delete(channel),
  },
}));
describe('classroom IPC boundaries', () => {
  it('requires main-window authorization before parsing or sending', async () => {
    const confirm = vi.fn();
    const authorize = vi.fn(async (event: IpcMainInvokeEvent) => {
      if (event.sender.id !== 1) throw new Error('untrusted sender');
    });
    const features = {
      context: { onChange: () => () => undefined },
      drafts: { confirm, onChange: () => () => undefined },
      broadcasts: { onChange: () => () => undefined },
      guidance: { onChange: () => () => undefined },
    } as unknown as ClassroomBroadcastFeatures;
    const stop = registerClassroomBroadcastIpc(
      {
        isDestroyed: () => false,
        webContents: { send: vi.fn() },
      } as unknown as BrowserWindow,
      features,
      authorize,
    );
    try {
      await expect(
        handlers.get(channels.confirmClassroomBroadcast)!(
          { sender: { id: 2 } },
          { taskId: 'bad' },
        ),
      ).rejects.toThrow('untrusted');
      expect(confirm).not.toHaveBeenCalled();
      await expect(
        handlers.get(channels.confirmClassroomBroadcast)!(
          { sender: { id: 1 } },
          { taskId: 'bad', recipients: ['student'] },
        ),
      ).rejects.toThrow();
      expect(confirm).not.toHaveBeenCalled();
    } finally {
      stop();
    }
    expect(handlers.size).toBe(0);
  });
});
