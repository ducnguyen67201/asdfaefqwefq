import { describe, expect, it, vi } from 'vitest';

import {
  configureMacOSDock,
  keepWindowAliveForBackgroundVoice,
  registerBackgroundTrayActivation,
} from './background-app-lifecycle';

describe('keepWindowAliveForBackgroundVoice', () => {
  it('hides the main window instead of destroying the voice host', () => {
    const closeListeners: Array<
      (event: { preventDefault(): void }) => void
    > = [];
    const window = {
      hide: vi.fn(),
      minimize: vi.fn(),
      on: vi.fn(
        (_event: 'close', listener: (event: { preventDefault(): void }) => void) => {
          closeListeners.push(listener);
        },
      ),
      removeListener: vi.fn(),
    };
    const preventDefault = vi.fn();

    const remove = keepWindowAliveForBackgroundVoice(window, {
      isShuttingDown: () => false,
      platform: 'darwin',
    });
    closeListeners[0]?.({ preventDefault });

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(window.hide).toHaveBeenCalledOnce();
    expect(window.minimize).not.toHaveBeenCalled();

    remove();
    expect(window.removeListener).toHaveBeenCalledWith(
      'close',
      expect.any(Function),
    );
  });

  it('minimizes on Windows so the app remains available in the taskbar', () => {
    const closeListeners: Array<
      (event: { preventDefault(): void }) => void
    > = [];
    const window = {
      hide: vi.fn(),
      minimize: vi.fn(),
      on: vi.fn(
        (_event: 'close', listener: (event: { preventDefault(): void }) => void) => {
          closeListeners.push(listener);
        },
      ),
      removeListener: vi.fn(),
    };
    const preventDefault = vi.fn();

    keepWindowAliveForBackgroundVoice(window, {
      isShuttingDown: () => false,
      platform: 'win32',
    });
    closeListeners[0]?.({ preventDefault });

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(window.minimize).toHaveBeenCalledOnce();
    expect(window.hide).not.toHaveBeenCalled();
  });

  it('allows the window to close during application shutdown', () => {
    const closeListeners: Array<
      (event: { preventDefault(): void }) => void
    > = [];
    const window = {
      hide: vi.fn(),
      minimize: vi.fn(),
      on: vi.fn(
        (_event: 'close', listener: (event: { preventDefault(): void }) => void) => {
          closeListeners.push(listener);
        },
      ),
      removeListener: vi.fn(),
    };
    const preventDefault = vi.fn();

    keepWindowAliveForBackgroundVoice(window, {
      isShuttingDown: () => true,
      platform: 'win32',
    });
    closeListeners[0]?.({ preventDefault });

    expect(preventDefault).not.toHaveBeenCalled();
    expect(window.hide).not.toHaveBeenCalled();
    expect(window.minimize).not.toHaveBeenCalled();
  });
});

describe('configureMacOSDock', () => {
  it('keeps Tro visible in the macOS Dock and app switcher', async () => {
    const dock = {
      setIcon: vi.fn(),
      show: vi.fn(async () => undefined),
    };
    const app = {
      dock,
      setActivationPolicy: vi.fn(),
    };

    await configureMacOSDock(app, 'darwin', '/assets/tro.png');

    expect(app.setActivationPolicy).toHaveBeenCalledWith('regular');
    expect(dock.setIcon).toHaveBeenCalledWith('/assets/tro.png');
    expect(dock.show).toHaveBeenCalledOnce();
  });

  it('does not use macOS-only APIs on Windows', async () => {
    const dock = {
      setIcon: vi.fn(),
      show: vi.fn(async () => undefined),
    };
    const app = {
      dock,
      setActivationPolicy: vi.fn(),
    };

    await configureMacOSDock(app, 'win32', '/assets/tro.png');

    expect(app.setActivationPolicy).not.toHaveBeenCalled();
    expect(dock.setIcon).not.toHaveBeenCalled();
    expect(dock.show).not.toHaveBeenCalled();
  });
});

describe('registerBackgroundTrayActivation', () => {
  it('reveals Tro on a single tray click and opens actions on right click', () => {
    const listeners = new Map<string, () => void>();
    const tray = {
      on: vi.fn((event: string, listener: () => void) => {
        listeners.set(event, listener);
      }),
      popUpContextMenu: vi.fn(),
      setContextMenu: vi.fn(),
    };
    const reveal = vi.fn();
    const menu = { id: 'background-actions' };

    registerBackgroundTrayActivation(tray, menu, {
      platform: 'darwin',
      reveal,
    });
    listeners.get('click')?.();
    listeners.get('right-click')?.();

    expect(reveal).toHaveBeenCalledOnce();
    expect(tray.popUpContextMenu).toHaveBeenCalledWith(menu);
    expect(tray.setContextMenu).not.toHaveBeenCalled();
  });

  it('uses the native context-menu behavior on Linux trays', () => {
    const tray = {
      on: vi.fn(),
      popUpContextMenu: vi.fn(),
      setContextMenu: vi.fn(),
    };
    const menu = { id: 'background-actions' };

    registerBackgroundTrayActivation(tray, menu, {
      platform: 'linux',
      reveal: vi.fn(),
    });

    expect(tray.setContextMenu).toHaveBeenCalledWith(menu);
    expect(tray.on).not.toHaveBeenCalled();
  });
});
