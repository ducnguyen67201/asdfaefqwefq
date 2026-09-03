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
    ReturnType<CoachRuntimeDependencies['presenter']['presentSequence']>
  > | null = null,
) {
  const current = observation();
  const terminal = vi.fn<CoachRuntimeDependencies['onTerminal']>();
  const status = vi.fn<CoachRuntimeDependencies['onStatus']>();
  const startObservationSession = vi.fn(async () => undefined);
  const releaseObservationSession = vi.fn();
  const observe = vi.fn(async () => current);
  const presentSequence = vi.fn(async (
    steps: Parameters<CoachRuntimeDependencies['presenter']['presentSequence']>[0],
    context: Parameters<CoachRuntimeDependencies['presenter']['presentSequence']>[1],
  ) => {
    if (presenterResult) {
      for (const [index, step] of steps.entries()) {
        await context.onStepStart?.(step, index, steps.length);
      }
      return presenterResult;
    }
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
    presentSequence,
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
    presentSequence,
    releaseObservationSession,
    runtime: new CoachRuntime(dependencies),
    startObservationSession,
    status,
    terminal,
  };
}

function sequenceFor(current: DesktopObservation) {
  return {
    kind: 'coach_sequence' as const,
    language: 'en' as const,
    observationId: current.observationId,
    observationFingerprint: current.fingerprint,
    steps: [
      {
        hook: 'Ready?',
        instruction: 'Open Variables.',
        reason: 'It stores a changing score.',
        expectedOutcome: 'The Variables palette appears.',
        target: 'Variables button',
        point: { x: 200, y: 400 },
      },
      {
        hook: 'Next!',
        instruction: 'Choose Make a Variable.',
        reason: 'This creates a place for the score.',
        expectedOutcome: 'The variable dialog opens.',
        target: 'Make a Variable button',
        point: { x: 800, y: 200 },
      },
    ],
  };
}

describe('Coach decision contract', () => {
  it('rejects legacy model-owned target rectangles', () => {
    const current = observation();

    expect(CoachDecisionSchema.safeParse({
      ...sequenceFor(current),
      steps: [{
        ...sequenceFor(current).steps[0],
        region: { x: 150, y: 350, width: 100, height: 100 },
      }],
    }).success).toBe(false);
  });

  it('bounds a sequence to eight visible targets', () => {
    const current = observation();
    const sequence = sequenceFor(current);

    expect(CoachDecisionSchema.safeParse({
      ...sequence,
      steps: Array.from({ length: 9 }, () => sequence.steps[0]),
    }).success).toBe(false);
  });
});

describe('CoachRuntime', () => {
  it('uses one capture and one model call for the complete visible sequence', async () => {
    const setupResult = setup(
      async ({ observation: current }) => sequenceFor(current!),
      { outcome: 'presented' },
    );
    const taskId = randomUUID();

    await setupResult.runtime.start({
      taskId,
      request: 'Show me how to do this',
      activity: null,
      requiresObservation: true,
      priorProgress: null,
    });
    await vi.waitFor(() => expect(setupResult.dependencies.presenter.presentSequence).toHaveBeenCalledOnce());

    expect(setupResult.dependencies.observe).toHaveBeenCalledOnce();
    expect(setupResult.startObservationSession).toHaveBeenCalledOnce();
    expect(setupResult.startObservationSession).toHaveBeenCalledWith(
      taskId,
      expect.any(AbortSignal),
    );
    expect(setupResult.startObservationSession.mock.invocationCallOrder[0])
      .toBeLessThan(setupResult.observe.mock.invocationCallOrder[0]!);
    expect(setupResult.dependencies.decide).toHaveBeenCalledOnce();
    expect(setupResult.dependencies.presenter.presentSequence).toHaveBeenCalledOnce();
    const presentedSteps = setupResult.presentSequence.mock.calls[0]?.[0];
    expect(presentedSteps).toHaveLength(2);
    expect(presentedSteps?.[0]).toMatchObject({ screenPoint: { x: 240, y: 320 } });
    expect(presentedSteps?.[1]).toMatchObject({ screenPoint: { x: 960, y: 160 } });
    expect(presentedSteps?.[0]).not.toHaveProperty('screenRegion');
    expect(setupResult.terminal).toHaveBeenCalledWith(taskId, expect.objectContaining({
      finalOutput: '1. Open Variables.\n2. Choose Make a Variable.',
      status: 'completed',
    }));
    expect(setupResult.dependencies.onProgress).toHaveBeenCalledTimes(2);
    expect(setupResult.releaseObservationSession).toHaveBeenCalledOnce();
  });

  it('does not observe again or ask for another decision after presentation', async () => {
    const decisions = vi.fn(async ({ observation: current }) => sequenceFor(current!));
    const setupResult = setup(decisions, { outcome: 'presented' });
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
    expect(setupResult.dependencies.decide).toHaveBeenCalledOnce();
  });

  it('rejects stale model coordinates instead of displaying them', async () => {
    const setupResult = setup(async () => ({
      ...sequenceFor(setupResult.current),
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

    expect(setupResult.dependencies.presenter.presentSequence).not.toHaveBeenCalled();
    expect(setupResult.terminal).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: 'failed', message: 'Coach returned a stale screen target.' }),
    );
  });

  it('fails and releases the session when presentation cannot remain active', async () => {
    const setupResult = setup(
      async ({ observation: current }) => sequenceFor(current!),
      { outcome: 'unavailable' },
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
          observationId: null,
          observationFingerprint: null,
          steps: null,
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
          kind: 'coach_sequence',
          text: null,
          language: 'vi',
          observationId: current.observationId,
          observationFingerprint: current.fingerprint,
          steps: [{
            hook: 'h'.repeat(50),
            instruction: 'i'.repeat(90),
            reason: 'r'.repeat(90),
            expectedOutcome: 'Bảng Biến số xuất hiện.',
            target: 'Nút Biến số',
            point: { x: 200, y: 400 },
          }],
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

    expect(decision.kind).toBe('coach_sequence');
    if (decision.kind !== 'coach_sequence') throw new Error('Expected a Coach sequence.');
    const step = decision.steps[0]!;
    expect([step.hook, step.instruction, step.reason].join(' ').length)
      .toBeLessThanOrEqual(160);
    expect(step.hook).toHaveLength(36);
    expect(step.instruction).toHaveLength(76);
    expect(step.reason).toHaveLength(46);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const requestBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as {
      text: { format: { schema: { properties: { steps: { anyOf: Array<{ items?: { properties: Record<string, { maxLength?: number }> }; maxItems?: number }> } } } } };
    };
    const properties = requestBody.text.format.schema.properties;
    const stepProperties = properties.steps.anyOf[0]?.items?.properties;
    expect(properties.steps.anyOf[0]?.maxItems).toBe(8);
    expect(stepProperties?.hook?.maxLength).toBe(36);
    expect(stepProperties?.instruction?.maxLength).toBe(76);
    expect(stepProperties?.reason?.maxLength).toBe(46);
    expect(stepProperties).toHaveProperty('point');
    expect(stepProperties).not.toHaveProperty('region');
  });
});
