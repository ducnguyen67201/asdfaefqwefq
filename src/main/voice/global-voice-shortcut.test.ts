import { describe, expect, it, vi } from 'vitest';

import type { VoiceShortcutEvent } from '../../shared/contracts';
import { IPC_CHANNELS } from '../../shared/desktop-api';

import {
  MACOS_GLOBAL_VOICE_MODE_TOGGLE_SHORTCUT,
  registerGlobalVoiceModeToggleShortcut,
  registerGlobalVoiceShortcut,
  WINDOWS_GLOBAL_VOICE_MODE_TOGGLE_SHORTCUT,
  WINDOWS_GLOBAL_VOICE_SHORTCUT,
} from './global-voice-shortcut';

function deferred<T>(): {
  promise: Promise<T>;
  reject(error: unknown): void;
  resolve(value: T): void;
} {
  let reject!: (error: unknown) => void;
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, reject, resolve };
}

describe('registerGlobalVoiceShortcut', () => {
  it('forwards modifier-only Windows shortcut events from the system watcher', () => {
    const registry = {
      register: vi.fn(),
      unregister: vi.fn(),
    };
    const send = vi.fn();
    const stopWatching = vi.fn();
    let listener: ((event: VoiceShortcutEvent) => void) | undefined;
    const unregister = registerGlobalVoiceShortcut({
      getTarget: () => ({
        isDestroyed: () => false,
        isFocused: () => false,
        webContents: { send },
      }),
      platform: 'win32',
      registry,
      watchForWindowsShortcut: (nextListener) => {
        listener = nextListener;
        return stopWatching;
      },
    });

    listener?.({ action: 'pressed', source: 'global' });
    listener?.({ action: 'released', source: 'global' });

    expect(registry.register).not.toHaveBeenCalled();
    expect(send).toHaveBeenNthCalledWith(1, IPC_CHANNELS.voiceShortcut, {
      action: 'pressed',
      source: 'global',
    });
    expect(send).toHaveBeenNthCalledWith(2, IPC_CHANNELS.voiceShortcut, {
      action: 'released',
      source: 'global',
    });
    unregister();
    expect(stopWatching).toHaveBeenCalledOnce();
  });

  it('sends one global voice press, ignores repeats, and sends release when keys are up', async () => {
    const callbacks = new Map<string, () => void>();
    const release = deferred<void>();
    const registry = {
      register: vi.fn((accelerator: string, callback: () => void) => {
        callbacks.set(accelerator, callback);
        return true;
      }),
      unregister: vi.fn(),
    };
    const send = vi.fn();
    const waitForRelease = vi.fn(() => release.promise);
    const logger = { warn: vi.fn() };
    const unregister = registerGlobalVoiceShortcut({
      getTarget: () => ({
        isDestroyed: () => false,
        isFocused: () => false,
        webContents: { send },
      }),
      logger,
      platform: 'win32',
      registry,
      waitForRelease,
    });

    expect(registry.register).toHaveBeenCalledWith(
      WINDOWS_GLOBAL_VOICE_SHORTCUT,
      expect.any(Function),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Control+Alt+Space will be used as the fallback'),
    );

    callbacks.get(WINDOWS_GLOBAL_VOICE_SHORTCUT)?.();
    callbacks.get(WINDOWS_GLOBAL_VOICE_SHORTCUT)?.();

    expect(send).toHaveBeenCalledWith(IPC_CHANNELS.voiceShortcut, {
      action: 'pressed',
      source: 'global',
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(waitForRelease).toHaveBeenCalledOnce();

    release.resolve();
    await release.promise;
    await Promise.resolve();

    expect(send).toHaveBeenLastCalledWith(IPC_CHANNELS.voiceShortcut, {
      action: 'released',
      source: 'global',
    });

    unregister();
    expect(registry.unregister).toHaveBeenCalledWith(
      WINDOWS_GLOBAL_VOICE_SHORTCUT,
    );
  });

  it('uses the shared fallback when the Windows watcher cannot start', () => {
    const callbacks = new Map<string, () => void>();
    const registry = {
      register: vi.fn((accelerator: string, callback: () => void) => {
        callbacks.set(accelerator, callback);
        return true;
      }),
      unregister: vi.fn(),
    };
    const send = vi.fn();
    const unregister = registerGlobalVoiceShortcut({
      getTarget: () => ({
        isDestroyed: () => false,
        isFocused: () => false,
        webContents: { send },
      }),
      logger: { warn: vi.fn() },
      platform: 'win32',
      registry,
      waitForRelease: vi.fn(() => new Promise<void>(() => undefined)),
      watchForWindowsShortcut: () => undefined,
    });

    callbacks.get(WINDOWS_GLOBAL_VOICE_SHORTCUT)?.();

    expect(send).toHaveBeenCalledWith(IPC_CHANNELS.voiceShortcut, {
      action: 'pressed',
      source: 'global',
    });
    unregister();
  });

  it('lets the focused renderer handle voice shortcuts locally', () => {
    const callbacks = new Map<string, () => void>();
    const registry = {
      register: vi.fn((accelerator: string, callback: () => void) => {
        callbacks.set(accelerator, callback);
        return true;
      }),
      unregister: vi.fn(),
    };
    const send = vi.fn();
    const waitForRelease = vi.fn(async () => undefined);

    registerGlobalVoiceShortcut({
      getTarget: () => ({
        isDestroyed: () => false,
        isFocused: () => true,
        webContents: { send },
      }),
      logger: { warn: vi.fn() },
      platform: 'win32',
      registry,
      waitForRelease,
    });

    callbacks.get(WINDOWS_GLOBAL_VOICE_SHORTCUT)?.();

    expect(send).not.toHaveBeenCalled();
    expect(waitForRelease).not.toHaveBeenCalled();
  });

  it('aborts the active release watcher when unregistered', () => {
    const callbacks = new Map<string, () => void>();
    const releaseSignal: { current?: AbortSignal } = {};
    const registry = {
      register: vi.fn((accelerator: string, callback: () => void) => {
        callbacks.set(accelerator, callback);
        return true;
      }),
      unregister: vi.fn(),
    };
    const unregister = registerGlobalVoiceShortcut({
      getTarget: () => ({
        isDestroyed: () => false,
        isFocused: () => false,
        webContents: { send: vi.fn() },
      }),
      logger: { warn: vi.fn() },
      platform: 'win32',
      registry,
      waitForRelease: vi.fn((signal) => {
        releaseSignal.current = signal;
        return new Promise<void>(() => undefined);
      }),
    });

    callbacks.get(WINDOWS_GLOBAL_VOICE_SHORTCUT)?.();
    unregister();

    expect(releaseSignal.current?.aborted).toBe(true);
    expect(registry.unregister).toHaveBeenCalledWith(
      WINDOWS_GLOBAL_VOICE_SHORTCUT,
    );
  });

  it('forwards system-wide macOS modifier press and release events', () => {
    const registry = {
      register: vi.fn(),
      unregister: vi.fn(),
    };
    const send = vi.fn();
    const stopWatching = vi.fn();
    const shortcutListeners: Array<
      (event: VoiceShortcutEvent) => void
    > = [];
    const watchForMacOSShortcut = vi.fn(
      (listener: (event: VoiceShortcutEvent) => void) => {
        shortcutListeners.push(listener);
        return stopWatching;
      },
    );
    const unregister = registerGlobalVoiceShortcut({
      getTarget: () => ({
        isDestroyed: () => false,
        isFocused: () => false,
        webContents: { send },
      }),
      logger: { warn: vi.fn() },
      platform: 'darwin',
      registry,
      watchForMacOSShortcut,
    });

    expect(registry.register).not.toHaveBeenCalled();
    expect(watchForMacOSShortcut).toHaveBeenCalledOnce();

    shortcutListeners[0]?.({ action: 'pressed', source: 'global' });
    shortcutListeners[0]?.({ action: 'released', source: 'global' });

    expect(send).toHaveBeenNthCalledWith(1, IPC_CHANNELS.voiceShortcut, {
      action: 'pressed',
      source: 'global',
    });
    expect(send).toHaveBeenNthCalledWith(2, IPC_CHANNELS.voiceShortcut, {
      action: 'released',
      source: 'global',
    });

    unregister();
    expect(stopWatching).toHaveBeenCalledOnce();
  });

  it('forwards a macOS release when the target becomes focused during the hold', () => {
    const registry = {
      register: vi.fn(),
      unregister: vi.fn(),
    };
    const send = vi.fn();
    const shortcutListeners: Array<
      (event: VoiceShortcutEvent) => void
    > = [];
    const watchForMacOSShortcut = vi.fn(
      (listener: (event: VoiceShortcutEvent) => void) => {
        shortcutListeners.push(listener);
        return vi.fn();
      },
    );
    let isFocused = false;

    registerGlobalVoiceShortcut({
      getTarget: () => ({
        isDestroyed: () => false,
        isFocused: () => isFocused,
        webContents: { send },
      }),
      logger: { warn: vi.fn() },
      platform: 'darwin',
      registry,
      watchForMacOSShortcut,
    });

    shortcutListeners[0]?.({
      action: 'pressed',
      source: 'global',
    });
    isFocused = true;
    shortcutListeners[0]?.({
      action: 'released',
      source: 'global',
    });

    expect(send).toHaveBeenNthCalledWith(1, IPC_CHANNELS.voiceShortcut, {
      action: 'pressed',
      source: 'global',
    });
    expect(send).toHaveBeenNthCalledWith(2, IPC_CHANNELS.voiceShortcut, {
      action: 'released',
      source: 'global',
    });
  });

  it('does not register a global voice shortcut on unsupported platforms', () => {
    const registry = {
      register: vi.fn(),
      unregister: vi.fn(),
    };

    const unregister = registerGlobalVoiceShortcut({
      getTarget: () => null,
      logger: { warn: vi.fn() },
      platform: 'linux',
      registry,
      waitForRelease: vi.fn(async () => undefined),
    });

    expect(registry.register).not.toHaveBeenCalled();
    unregister();
    expect(registry.unregister).not.toHaveBeenCalled();
  });

  it('warns when Windows rejects the global voice shortcut registration', () => {
    const logger = { warn: vi.fn() };
    const registry = {
      register: vi.fn(() => false),
      unregister: vi.fn(),
    };

    const unregister = registerGlobalVoiceShortcut({
      getTarget: () => null,
      logger,
      platform: 'win32',
      registry,
      waitForRelease: vi.fn(async () => undefined),
    });

    expect(logger.warn).toHaveBeenCalledWith(
      '[voice] Could not register global voice shortcut.',
      { accelerator: WINDOWS_GLOBAL_VOICE_SHORTCUT },
    );
    unregister();
    expect(registry.unregister).not.toHaveBeenCalled();
  });
});

describe('registerGlobalVoiceModeToggleShortcut', () => {
  it('delivers Command+Backslash once per press', () => {
    const callbacks = new Map<string, () => void>();
    const registry = {
      register: vi.fn((accelerator: string, callback: () => void) => {
        callbacks.set(accelerator, callback);
        return true;
      }),
      unregister: vi.fn(),
    };
    const send = vi.fn();
    let now = 1_000;
    const unregister = registerGlobalVoiceModeToggleShortcut({
      getTarget: () => ({
        isDestroyed: () => false,
        webContents: { send },
      }),
      now: () => now,
      platform: 'darwin',
      registry,
    });

    expect(registry.register).toHaveBeenCalledWith(
      MACOS_GLOBAL_VOICE_MODE_TOGGLE_SHORTCUT,
      expect.any(Function),
    );
    callbacks.get(MACOS_GLOBAL_VOICE_MODE_TOGGLE_SHORTCUT)?.();
    now += 100;
    callbacks.get(MACOS_GLOBAL_VOICE_MODE_TOGGLE_SHORTCUT)?.();

    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(
      IPC_CHANNELS.voiceModeToggleRequested,
      { source: 'global' },
    );

    unregister();
    expect(registry.unregister).toHaveBeenCalledWith(
      MACOS_GLOBAL_VOICE_MODE_TOGGLE_SHORTCUT,
    );
  });

  it('delivers the registered shortcut while the target is focused', () => {
    const callbacks = new Map<string, () => void>();
    const registry = {
      register: vi.fn((accelerator: string, callback: () => void) => {
        callbacks.set(accelerator, callback);
        return true;
      }),
      unregister: vi.fn(),
    };
    const send = vi.fn();
    const focusedTarget = {
      isDestroyed: () => false,
      isFocused: () => true,
      webContents: { send },
    };
    registerGlobalVoiceModeToggleShortcut({
      getTarget: () => focusedTarget,
      platform: 'darwin',
      registry,
    });

    callbacks.get(MACOS_GLOBAL_VOICE_MODE_TOGGLE_SHORTCUT)?.();

    expect(send).toHaveBeenCalledWith(
      IPC_CHANNELS.voiceModeToggleRequested,
      { source: 'global' },
    );
  });

  it('ignores destroyed and missing targets', () => {
    const callbacks = new Map<string, () => void>();
    const registry = {
      register: vi.fn((accelerator: string, callback: () => void) => {
        callbacks.set(accelerator, callback);
        return true;
      }),
      unregister: vi.fn(),
    };
    const send = vi.fn();
    let targetState: 'destroyed' | 'missing' = 'destroyed';
    registerGlobalVoiceModeToggleShortcut({
      getTarget: () =>
        targetState === 'missing'
          ? null
          : {
              isDestroyed: () => true,
              webContents: { send },
            },
      platform: 'win32',
      registry,
    });

    const trigger = callbacks.get(WINDOWS_GLOBAL_VOICE_MODE_TOGGLE_SHORTCUT);
    trigger?.();
    targetState = 'missing';
    trigger?.();

    expect(send).not.toHaveBeenCalled();
  });

  it('warns without unregistering when the accelerator is unavailable', () => {
    const logger = { warn: vi.fn() };
    const registry = {
      register: vi.fn(() => false),
      unregister: vi.fn(),
    };
    const unregister = registerGlobalVoiceModeToggleShortcut({
      getTarget: () => null,
      logger,
      platform: 'darwin',
      registry,
    });

    expect(logger.warn).toHaveBeenCalledWith(
      '[voice] Could not register global voice mode shortcut.',
      { accelerator: MACOS_GLOBAL_VOICE_MODE_TOGGLE_SHORTCUT },
    );
    unregister();
    expect(registry.unregister).not.toHaveBeenCalled();
  });

  it('does not register the mode toggle on unsupported platforms', () => {
    const registry = {
      register: vi.fn(),
      unregister: vi.fn(),
    };
    const unregister = registerGlobalVoiceModeToggleShortcut({
      getTarget: () => null,
      platform: 'linux',
      registry,
    });

    expect(registry.register).not.toHaveBeenCalled();
    unregister();
    expect(registry.unregister).not.toHaveBeenCalled();
  });
});
