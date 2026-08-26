import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { CuaWindow } from '../cua/cua-semantic-contracts';
import type {
  CuaDictationDeliveryResult,
  CuaDictationStatus,
} from '../cua/cua-service';

import { DictationService } from './dictation-service';

function target(
  overrides: Partial<CuaWindow> = {},
): CuaWindow {
  return {
    app_name: 'Notes',
    bounds: { height: 600, width: 800, x: 0, y: 0 },
    is_on_screen: true,
    on_current_space: true,
    pid: 10,
    title: 'Private title',
    window_id: 20,
    z_index: 1,
    ...overrides,
  };
}

function setup(windows: CuaWindow[] = [target()]) {
  const cua = {
    connectForDictation: vi.fn(async (): Promise<CuaDictationStatus> => ({
      state: 'ready',
      summary: 'Ready.',
    })),
    endDictationSession: vi.fn(async () => undefined),
    listDictationWindows: vi.fn(async () => windows),
    startDictationSession: vi.fn(async () => undefined),
    typeDictationText: vi.fn(
      async (): Promise<CuaDictationDeliveryResult> => ({ effect: 'confirmed' }),
    ),
  };
  const logger = { info: vi.fn(), warn: vi.fn() };
  const service = new DictationService({
    cua,
    logger,
    ownProcessId: 99,
  });
  return { cua, logger, service };
}

describe('DictationService', () => {
  it('locks and revalidates one frontmost external window before typing once', async () => {
    const { cua, service } = setup();
    const turnId = randomUUID();
    await expect(service.begin(turnId)).resolves.toMatchObject({
      status: 'ready',
      targetApplication: 'Notes',
    });
    await expect(service.commit(turnId, 'Hello')).resolves.toMatchObject({
      disposition: 'inserted',
      reason: 'confirmed',
    });
    expect(cua.typeDictationText).toHaveBeenCalledOnce();
    expect(cua.typeDictationText).toHaveBeenCalledWith({
      processId: 10,
      sessionId: `dictation:${turnId}`,
      text: 'Hello',
      windowId: 20,
    });
    expect(cua.endDictationSession).toHaveBeenCalledOnce();
  });

  it('does not type when the target changes or becomes ambiguous', async () => {
    const { cua, service } = setup();
    const turnId = randomUUID();
    await service.begin(turnId);
    cua.listDictationWindows.mockResolvedValueOnce([
      target({ pid: 11, window_id: 21 }),
    ]);
    await expect(service.commit(turnId, 'Hello')).resolves.toMatchObject({
      disposition: 'not_inserted',
      reason: 'target_changed',
    });
    expect(cua.typeDictationText).not.toHaveBeenCalled();

    const ambiguous = setup();
    const ambiguousTurnId = randomUUID();
    await ambiguous.service.begin(ambiguousTurnId);
    ambiguous.cua.listDictationWindows.mockResolvedValueOnce([
      target({ pid: 10, window_id: 20, z_index: 2 }),
      target({ pid: 11, window_id: 21, z_index: 2 }),
    ]);
    await expect(
      ambiguous.service.commit(ambiguousTurnId, 'Hello'),
    ).resolves.toMatchObject({
      disposition: 'not_inserted',
      reason: 'target_changed',
    });
    expect(ambiguous.cua.typeDictationText).not.toHaveBeenCalled();
  });

  it('never retries an unverified delivery or duplicate commit', async () => {
    const { cua, service } = setup();
    cua.typeDictationText.mockResolvedValueOnce({
      effect: 'delivery_unverified',
    });
    const turnId = randomUUID();
    await service.begin(turnId);
    await expect(service.commit(turnId, 'Hello')).resolves.toMatchObject({
      disposition: 'delivery_unverified',
    });
    await expect(service.commit(turnId, 'Hello')).resolves.toMatchObject({
      reason: 'already_consumed',
    });
    expect(cua.typeDictationText).toHaveBeenCalledOnce();
  });

  it('reports an in-flight delivery as unverified when cancelled', async () => {
    let resolveDelivery: () => void = () => undefined;
    const { cua, service } = setup();
    cua.typeDictationText.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveDelivery = () => resolve({ effect: 'confirmed' });
        }),
    );
    const turnId = randomUUID();
    await service.begin(turnId);
    const committing = service.commit(turnId, 'Hello');

    await Promise.resolve();
    await service.cancel(turnId);
    resolveDelivery();

    await expect(committing).resolves.toMatchObject({
      disposition: 'delivery_unverified',
      reason: 'cancelled',
    });
    expect(cua.typeDictationText).toHaveBeenCalledOnce();
    expect(cua.endDictationSession).toHaveBeenCalledOnce();
  });

  it('rejects concurrent turns without cancelling the active target', async () => {
    const { cua, service } = setup();
    const first = randomUUID();
    await service.begin(first);
    await expect(service.begin(randomUUID())).resolves.toMatchObject({
      status: 'busy',
    });
    expect(cua.endDictationSession).not.toHaveBeenCalled();
    await service.cancel(first);
    expect(cua.endDictationSession).toHaveBeenCalledOnce();
  });

  it('reserves the preparation slot before awaiting the CUA connection', async () => {
    let resolveConnection: () => void = () => undefined;
    const { cua, service } = setup();
    cua.connectForDictation.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveConnection = () =>
            resolve({ state: 'ready' as const, summary: 'Ready.' });
        }),
    );
    const first = service.begin(randomUUID());
    await expect(service.begin(randomUUID())).resolves.toMatchObject({
      status: 'busy',
    });
    resolveConnection();
    await expect(first).resolves.toMatchObject({ status: 'ready' });
    expect(cua.startDictationSession).toHaveBeenCalledOnce();
  });

  it('fails before microphone work when Accessibility is missing', async () => {
    const { cua, service } = setup();
    cua.connectForDictation.mockResolvedValueOnce({
      reason: 'accessibility',
      state: 'permission_required',
      summary: 'Accessibility required.',
    });
    await expect(service.begin(randomUUID())).resolves.toMatchObject({
      reason: 'accessibility',
      status: 'permission_required',
    });
    expect(cua.startDictationSession).not.toHaveBeenCalled();
    expect(cua.listDictationWindows).not.toHaveBeenCalled();
  });

  it('fails closed when no unique external target exists', async () => {
    const { cua, service } = setup([]);

    await expect(service.begin(randomUUID())).resolves.toMatchObject({
      reason: 'no_target',
      status: 'unavailable',
    });
    expect(cua.typeDictationText).not.toHaveBeenCalled();
    expect(cua.endDictationSession).toHaveBeenCalledOnce();
  });

  it('cancels preparation before a late connection can start a session', async () => {
    let resolveConnection: () => void = () => undefined;
    const { cua, service } = setup();
    cua.connectForDictation.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveConnection = () =>
            resolve({ state: 'ready' as const, summary: 'Ready.' });
        }),
    );
    const turnId = randomUUID();
    const preparing = service.begin(turnId);

    await service.cancel(turnId);
    resolveConnection();

    await expect(preparing).resolves.toMatchObject({
      status: 'unavailable',
    });
    expect(cua.startDictationSession).not.toHaveBeenCalled();
    await expect(service.begin(turnId)).resolves.toMatchObject({
      status: 'busy',
    });
  });

  it('does not place transcript, app name, title, pid, or window ID in logs', async () => {
    const { logger, service } = setup([
      target({
        app_name: 'Sentinel Private App',
        pid: 765_432,
        title: 'Sentinel Private Window',
        window_id: 987_654,
      }),
    ]);
    const turnId = randomUUID();
    await service.begin(turnId);
    await service.commit(turnId, 'VOICE_SECRET_SENTINEL_7f4c');

    const logs = JSON.stringify([
      ...logger.info.mock.calls,
      ...logger.warn.mock.calls,
    ]);
    expect(logs).not.toContain('VOICE_SECRET_SENTINEL_7f4c');
    expect(logs).not.toContain('Sentinel Private App');
    expect(logs).not.toContain('Sentinel Private Window');
    expect(logs).not.toContain('765432');
    expect(logs).not.toContain('987654');
  });
});
