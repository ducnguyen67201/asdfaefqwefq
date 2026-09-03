import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DesktopObservation } from '../agent/execution-contracts';

import { CoachDecisionSchema } from './coach-contracts';
import {
  CoachRuntime,
  createAuthenticatedCoachDecisionClient,
  type CoachRuntimeDependencies,
} from './coach-runtime';

const fingerprint = 'a'.repeat(64);

afterEach(() => {
  vi.unstubAllGlobals();
});

function observation(overrides: Partial<DesktopObservation> = {}): DesktopObservation {
  return {
    observationId: randomUUID(),
    taskId: randomUUID(),
    capturedAt: '2026-09-02T00:00:00.000Z',
    text: 'Scratch Variables button',
    coordinateSpace: {
      screenHeight: 800,
      screenWidth: 1_200,
      screenshotHeight: 800,
      screenshotWidth: 1_200,
    },
    route: 'desktop_vision',
    degraded: false,
    fingerprint,
    ...overrides,
  };
}

function setup(
  decide: CoachRuntimeDependencies['decide'],
  presenterResult: Awaited<
    ReturnType<CoachRuntimeDependencies['presenter']['presentStep']>
  > | null = null,
) {
  const current = observation();
  const terminal = vi.fn<CoachRuntimeDependencies['onTerminal']>();
  const status = vi.fn<CoachRuntimeDependencies['onStatus']>();
  const startObservationSession = vi.fn(async () => undefined);
  const releaseObservationSession = vi.fn();
  const observe = vi.fn(async () => current);
  const presentStep = vi.fn((
    _step: Parameters<CoachRuntimeDependencies['presenter']['presentStep']>[0],
    context: Parameters<CoachRuntimeDependencies['presenter']['presentStep']>[1],
  ) => {
    if (presenterResult) return Promise.resolve(presenterResult);
    return new Promise((_, reject) => {
      context.signal.addEventListener('abort', () => {
        const error = new Error('cancelled');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    });
  });
  const presenter = {
    beginSession: vi.fn(),
    cancelGuidance: vi.fn(),
    finishSession: vi.fn(),
    presentStep,
  } as unknown as CoachRuntimeDependencies['presenter'];
  const dependencies: CoachRuntimeDependencies = {
    decide: vi.fn(decide),
    startObservationSession,
    releaseObservationSession,
    observe,
    onProgress: vi.fn(),
    onStatus: status,
    onTerminal: terminal,
    presenter,
  };
  return {
    current,
    dependencies,
    observe,
    presentStep,
    releaseObservationSession,
    runtime: new CoachRuntime(dependencies),
    startObservationSession,
    status,
    terminal,
  };
}

function stepFor(current: DesktopObservation) {
  return {
    kind: 'coach_step' as const,
    stepNumber: 1,
    hook: 'Ready?',
    instruction: 'Open Variables.',
    reason: 'It stores a changing score.',
    expectedOutcome: 'The Variables palette appears.',
    target: 'Variables button',
    language: 'en' as const,
    observationId: current.observationId,
    observationFingerprint: current.fingerprint,
    point: { x: 200, y: 400 },
  };
}

describe('Coach decision contract', () => {
  it('rejects legacy model-owned target rectangles', () => {
    const current = observation();

    expect(CoachDecisionSchema.safeParse({
      ...stepFor(current),
      region: { x: 150, y: 350, width: 100, height: 100 },
    }).success).toBe(false);
  });
});

describe('CoachRuntime', () => {
  it('uses one capture and one model call for the first visible step, then idles', async () => {
    const setupResult = setup(async ({ observation: current }) => stepFor(current!));
    const taskId = randomUUID();

    await setupResult.runtime.start({
      taskId,
      request: 'Show me how to do this',
      activity: null,
      requiresObservation: true,
      priorProgress: null,
    });
    await vi.waitFor(() => expect(setupResult.dependencies.presenter.presentStep).toHaveBeenCalledOnce());

    expect(setupResult.dependencies.observe).toHaveBeenCalledOnce();
    expect(setupResult.startObservationSession).toHaveBeenCalledOnce();
    expect(setupResult.startObservationSession).toHaveBeenCalledWith(
      taskId,
      expect.any(AbortSignal),
    );
    expect(setupResult.startObservationSession.mock.invocationCallOrder[0])
      .toBeLessThan(setupResult.observe.mock.invocationCallOrder[0]!);
    expect(setupResult.dependencies.decide).toHaveBeenCalledOnce();
    expect(setupResult.dependencies.presenter.presentStep).toHaveBeenCalledOnce();
    const presentedStep = setupResult.presentStep.mock.calls[0]?.[0];
    expect(presentedStep).toMatchObject({ screenPoint: { x: 240, y: 320 } });
    expect(presentedStep).not.toHaveProperty('screenRegion');
    expect(setupResult.terminal).not.toHaveBeenCalled();
    setupResult.runtime.cancel(taskId);
    expect(setupResult.releaseObservationSession).toHaveBeenCalledOnce();
  });

  it('uses the post-action observation for exactly one next decision', async () => {
    const changed = observation({ fingerprint: 'b'.repeat(64) });
    const decisions = vi.fn(async ({ observation: current }) =>
      decisions.mock.calls.length === 1
        ? stepFor(current!)
        : { kind: 'complete' as const, recap: 'Great work — the Variables palette is open.' });
    const setupResult = setup(decisions, {
      learnerActivity: 'changed',
      observation: changed,
    });
    await setupResult.runtime.start({
      taskId: randomUUID(),
      request: 'Show me how',
      activity: null,
      requiresObservation: true,
      priorProgress: null,
    });
    await vi.waitFor(() => expect(setupResult.terminal).toHaveBeenCalledOnce());

    expect(setupResult.dependencies.observe).toHaveBeenCalledOnce();
    expect(setupResult.startObservationSession).toHaveBeenCalledOnce();
    expect(setupResult.dependencies.decide).toHaveBeenCalledTimes(2);
    expect(decisions.mock.calls[1]?.[0]).toMatchObject({
      observation: { fingerprint: changed.fingerprint },
    });
  });

  it('rejects stale model coordinates instead of displaying them', async () => {
    const setupResult = setup(async () => ({
      ...stepFor(setupResult.current),
      observationId: randomUUID(),
    }));
    await setupResult.runtime.start({
      taskId: randomUUID(),
      request: 'Show me',
      activity: null,
      requiresObservation: true,
      priorProgress: null,
    });
    await vi.waitFor(() => expect(setupResult.terminal).toHaveBeenCalledOnce());

    expect(setupResult.dependencies.presenter.presentStep).not.toHaveBeenCalled();
    expect(setupResult.terminal).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: 'failed', message: 'Coach returned a stale screen target.' }),
    );
  });

  it('fails and releases the session when presentation cannot remain active', async () => {
    const setupResult = setup(
      async ({ observation: current }) => stepFor(current!),
      { learnerActivity: 'timed_out' },
    );
    const taskId = randomUUID();

    await setupResult.runtime.start({
      taskId,
      request: 'Show me',
      activity: null,
      requiresObservation: true,
      priorProgress: null,
    });
    await vi.waitFor(() => expect(setupResult.terminal).toHaveBeenCalledOnce());

    expect(setupResult.terminal).toHaveBeenCalledWith(taskId, expect.objectContaining({
      status: 'failed',
    }));
    expect(setupResult.dependencies.presenter.finishSession).toHaveBeenCalledWith(taskId);
    expect(setupResult.releaseObservationSession).toHaveBeenCalledWith(taskId);
  });

  it('does not start CUA for a plain answer without screen context', async () => {
    const setupResult = setup(async () => ({
      kind: 'answer',
      language: 'en',
      text: 'A variable stores a value.',
    }));
    const taskId = randomUUID();

    await setupResult.runtime.start({
      taskId,
      request: 'What is a variable?',
      activity: null,
      requiresObservation: false,
      priorProgress: null,
    });
    await vi.waitFor(() => expect(setupResult.terminal).toHaveBeenCalledOnce());

    expect(setupResult.startObservationSession).not.toHaveBeenCalled();
    expect(setupResult.dependencies.observe).not.toHaveBeenCalled();
    expect(setupResult.releaseObservationSession).toHaveBeenCalledWith(taskId);
  });
});

describe('authenticated Coach decision client', () => {
  it('reserves one paid user turn for the Coach session and does not retry', async () => {
    const taskId = randomUUID();
    const agentTurnId = randomUUID();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: agentTurnId }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        output_text: JSON.stringify({
          kind: 'answer',
          text: 'A variable stores a value.',
          language: 'en',
          stepNumber: null,
          hook: null,
          instruction: null,
          reason: null,
          expectedOutcome: null,
          target: null,
          observationId: null,
          observationFingerprint: null,
          point: null,
          recap: null,
        }),
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = createAuthenticatedCoachDecisionClient({
      accessTokenProvider: async () => 'token',
      apiBaseUrl: 'https://api.example.test',
    });
    const input = {
      activity: null,
      observation: null,
      priorProgress: null,
      request: 'What is a variable?',
      taskId,
    };

    await expect(client.decide(input, new AbortController().signal)).resolves.toMatchObject({
      kind: 'answer',
    });
    await expect(client.decide(input, new AbortController().signal)).rejects.toThrow(
      'Coach model request failed (503).',
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/v1/agent-turns')))
      .toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/v1/openai/responses')))
      .toHaveLength(2);
    const requestBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as Record<string, unknown>;
    expect(requestBody).toMatchObject({
      parallel_tool_calls: false,
      store: false,
      tools: [],
    });
  });

  it('fits generated Coach speech to the presentation contract without another model call', async () => {
    const taskId = randomUUID();
    const current = observation({ taskId });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: randomUUID() }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        output_text: JSON.stringify({
          kind: 'coach_step',
          text: null,
          language: 'vi',
          stepNumber: 1,
          hook: 'h'.repeat(50),
          instruction: 'i'.repeat(90),
          reason: 'r'.repeat(90),
          expectedOutcome: 'Bảng Biến số xuất hiện.',
          target: 'Nút Biến số',
          observationId: current.observationId,
          observationFingerprint: current.fingerprint,
          point: { x: 200, y: 400 },
          recap: null,
        }),
      }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = createAuthenticatedCoachDecisionClient({
      accessTokenProvider: async () => 'token',
      apiBaseUrl: 'https://api.example.test',
    });

    const decision = await client.decide({
      activity: null,
      observation: current,
      priorProgress: null,
      request: 'Chỉ cho em bước tiếp theo',
      taskId,
    }, new AbortController().signal);

    expect(decision.kind).toBe('coach_step');
    if (decision.kind !== 'coach_step') throw new Error('Expected a Coach step.');
    expect([decision.hook, decision.instruction, decision.reason].join(' ').length)
      .toBeLessThanOrEqual(160);
    expect(decision.hook).toHaveLength(36);
    expect(decision.instruction).toHaveLength(76);
    expect(decision.reason).toHaveLength(46);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const requestBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as {
      text: { format: { schema: { properties: Record<string, { anyOf: Array<{ maxLength?: number }> }> } } };
    };
    const properties = requestBody.text.format.schema.properties;
    expect(properties.hook?.anyOf[0]?.maxLength).toBe(36);
    expect(properties.instruction?.anyOf[0]?.maxLength).toBe(76);
    expect(properties.reason?.anyOf[0]?.maxLength).toBe(46);
    expect(properties).toHaveProperty('point');
    expect(properties).not.toHaveProperty('region');
  });
});
