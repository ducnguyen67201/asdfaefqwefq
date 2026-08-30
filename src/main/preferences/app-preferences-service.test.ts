import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AppPreferencesService,
  FileAppPreferencesStore,
  type AppPreferencesStore,
} from './app-preferences-service';

const temporaryDirectories: string[] = [];

async function temporaryPreferencesPath(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'trocode-prefs-'));
  temporaryDirectories.push(directory);
  return path.join(directory, 'preferences.json');
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe('AppPreferencesService', () => {
  it('requires onboarding when no primary language has been saved', async () => {
    const service = new AppPreferencesService({
      read: vi.fn(async () => null),
      write: vi.fn(),
    });

    await expect(service.get()).resolves.toEqual({
      appLanguage: 'en',
      classroomPetEnabled: true,
      muteSystemAudioWhileSpeaking: false,
      primaryLanguage: null,
      voiceMode: 'dictation',
    });
    await expect(service.getPrimaryLanguage()).resolves.toBe('en');
  });

  it('validates and persists a primary language', async () => {
    let stored: unknown = null;
    const store: AppPreferencesStore = {
      read: vi.fn(async () => stored),
      write: vi.fn(async (preferences) => {
        stored = preferences;
      }),
    };
    const service = new AppPreferencesService(store);
    const listener = vi.fn();
    service.onChange(listener);

    await expect(
      service.update({
        appLanguage: 'vi',
        classroomPetEnabled: false,
        muteSystemAudioWhileSpeaking: true,
        primaryLanguage: 'vi',
        voiceMode: 'task',
      }),
    ).resolves.toEqual({
      appLanguage: 'vi',
      classroomPetEnabled: false,
      muteSystemAudioWhileSpeaking: true,
      primaryLanguage: 'vi',
      voiceMode: 'task',
    });
    await expect(service.getPrimaryLanguage()).resolves.toBe('vi');
    expect(store.write).toHaveBeenCalledWith({
      appLanguage: 'vi',
      classroomPetEnabled: false,
      muteSystemAudioWhileSpeaking: true,
      primaryLanguage: 'vi',
      voiceMode: 'task',
    });
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith({
      appLanguage: 'vi',
      classroomPetEnabled: false,
      muteSystemAudioWhileSpeaking: true,
      primaryLanguage: 'vi',
      voiceMode: 'task',
    });
  });

  it('does not emit when persistence fails', async () => {
    const service = new AppPreferencesService({
      read: vi.fn(async () => null),
      write: vi.fn(async () => {
        throw new Error('disk unavailable');
      }),
    });
    const listener = vi.fn();
    service.onChange(listener);

    await expect(
      service.update({ classroomPetEnabled: false, primaryLanguage: 'en' }),
    ).rejects.toThrow('disk unavailable');
    expect(listener).not.toHaveBeenCalled();
  });

  it('rejects unsupported language codes before writing', async () => {
    const store: AppPreferencesStore = {
      read: vi.fn(async () => null),
      write: vi.fn(),
    };
    const service = new AppPreferencesService(store);

    await expect(
      service.update({ primaryLanguage: 'xx' }),
    ).rejects.toThrow();
    expect(store.write).not.toHaveBeenCalled();
  });

  it('rejects an unsupported app language before writing', async () => {
    const store: AppPreferencesStore = {
      read: vi.fn(async () => null),
      write: vi.fn(),
    };
    const service = new AppPreferencesService(store);

    await expect(
      service.update({ appLanguage: 'fr', primaryLanguage: 'en' }),
    ).rejects.toThrow();
    expect(store.write).not.toHaveBeenCalled();
  });
});

describe('FileAppPreferencesStore', () => {
  it('round-trips preferences in the application data directory', async () => {
    const filePath = await temporaryPreferencesPath();
    const store = new FileAppPreferencesStore(filePath);

    await expect(store.read()).resolves.toBeNull();
    await store.write({
      appLanguage: 'vi',
      classroomPetEnabled: false,
      muteSystemAudioWhileSpeaking: true,
      primaryLanguage: 'en',
      voiceMode: 'task',
    });

    await expect(store.read()).resolves.toEqual({
      appLanguage: 'vi',
      classroomPetEnabled: false,
      muteSystemAudioWhileSpeaking: true,
      primaryLanguage: 'en',
      voiceMode: 'task',
    });
    await expect(readFile(filePath, 'utf8')).resolves.toContain(
      '"appLanguage": "vi"',
    );
    await expect(readFile(filePath, 'utf8')).resolves.not.toContain('autonomyMode');
    await expect(readFile(filePath, 'utf8')).resolves.toContain(
      '"classroomPetEnabled": false',
    );
    await expect(readFile(filePath, 'utf8')).resolves.toContain(
      '"muteSystemAudioWhileSpeaking": true',
    );
    await expect(readFile(filePath, 'utf8')).resolves.toContain(
      '"primaryLanguage": "en"',
    );
    await expect(readFile(filePath, 'utf8')).resolves.toContain(
      '"voiceMode": "task"',
    );
    if (process.platform !== 'win32') {
      expect((await stat(filePath)).mode & 0o777).toBe(0o600);
    }
  });

  it('loads old preferences and strips the removed autonomy field on save', async () => {
    const write = vi.fn();
    const service = new AppPreferencesService({
      read: vi.fn(async () => ({ autonomyMode: 'strict', primaryLanguage: 'vi' })),
      write,
    });

    await expect(service.get()).resolves.toEqual({
      appLanguage: 'en',
      classroomPetEnabled: true,
      muteSystemAudioWhileSpeaking: false,
      primaryLanguage: 'vi',
      voiceMode: 'dictation',
    });
    await service.update({ primaryLanguage: 'vi' });
    expect(write).toHaveBeenCalledWith(expect.not.objectContaining({ autonomyMode: expect.anything() }));
  });
});
