import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import { MAX_COACH_SPEECH_CHARACTERS } from '../../shared/contracts';
import {
  mapNormalizedPointToScreenshot,
  mapScreenshotPointToDesktop,
  type DesktopObservation,
} from '../agent/execution-contracts';
import type { CursorBuddyController } from '../companion/cursor-buddy-controller';

import {
  CoachDecisionSchema,
  CoachRuntimeStartSchema,
  type CoachDecision,
  type CoachProgress,
  type CoachRuntimeStart,
} from './coach-contracts';

export interface CoachDecisionInput {
  activity: CoachRuntimeStart['activity'];
  observation: DesktopObservation | null;
  priorProgress: CoachProgress | null;
  request: string;
  taskId: string;
}

export interface CoachRuntimeDependencies {
  decide(input: CoachDecisionInput, signal: AbortSignal): Promise<CoachDecision>;
  startObservationSession(taskId: string, signal: AbortSignal): Promise<void>;
  releaseObservationSession(taskId: string): void;
  releaseDecisionSession?(taskId: string): void;
  observe(taskId: string, signal: AbortSignal): Promise<DesktopObservation>;
  onProgress(taskId: string, progress: CoachProgress): Promise<void> | void;
  onStatus(
    taskId: string,
    phase: 'observing' | 'planning' | 'presenting' | 'waiting',
    summary: string,
  ): Promise<void> | void;
  onTerminal(
    taskId: string,
    terminal: { status: 'completed' | 'failed' | 'cancelled'; finalOutput: string | null; message: string },
  ): Promise<void> | void;
  presenter: Pick<CursorBuddyController, 'beginSession' | 'cancelGuidance' | 'finishSession' | 'presentStep'>;
}

/** Non-mutating, activity-gated teacher loop. */
export class CoachRuntime {
  private readonly active = new Map<string, AbortController>();

  constructor(private readonly dependencies: CoachRuntimeDependencies) {}

  start(input: CoachRuntimeStart): Promise<void> {
    const parsed = CoachRuntimeStartSchema.parse(input);
    if (this.active.has(parsed.taskId)) {
      throw new Error('A Coach session is already active for this task.');
    }
    const controller = new AbortController();
    this.active.set(parsed.taskId, controller);
    this.dependencies.presenter.beginSession(parsed.taskId);
    void this.run(parsed, controller).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      void this.dependencies.onTerminal(parsed.taskId, {
        status: 'failed',
        finalOutput: null,
        message: error instanceof Error ? error.message : 'Coach could not continue.',
      });
      this.finish(parsed.taskId, controller);
    });
    return Promise.resolve();
  }

  cancel(taskId: string): void {
    const controller = this.active.get(taskId);
    if (!controller) return;
    controller.abort();
    this.dependencies.presenter.cancelGuidance();
    this.dependencies.releaseObservationSession(taskId);
    this.dependencies.releaseDecisionSession?.(taskId);
    this.active.delete(taskId);
  }

  shutdown(): Promise<void> {
    for (const taskId of [...this.active.keys()]) this.cancel(taskId);
    return Promise.resolve();
  }

  private async run(input: CoachRuntimeStart, controller: AbortController): Promise<void> {
    let observation: DesktopObservation | null = null;
    let progress = input.priorProgress;
    if (input.requiresObservation) {
      await this.dependencies.onStatus(input.taskId, 'observing', 'Tro is looking at the current screen.');
      await this.dependencies.startObservationSession(input.taskId, controller.signal);
      observation = await this.dependencies.observe(input.taskId, controller.signal);
    }

    while (!controller.signal.aborted) {
      await this.dependencies.onStatus(input.taskId, 'planning', 'Tro is preparing one clear next step.');
      const modelStartedAt = Date.now();
      const decision = CoachDecisionSchema.parse(await this.dependencies.decide({
        activity: input.activity,
        observation,
        priorProgress: progress,
        request: input.request,
        taskId: input.taskId,
      }, controller.signal));
      await this.dependencies.onStatus(
        input.taskId,
        'planning',
        `Coach model request completed in ${Date.now() - modelStartedAt} ms.`,
      );

      if (decision.kind === 'answer') {
        await this.dependencies.onTerminal(input.taskId, {
          status: 'completed',
          finalOutput: decision.text,
          message: decision.text,
        });
        this.finish(input.taskId, controller);
        return;
      }
      if (decision.kind === 'complete') {
        progress = progressFrom(input, progress?.stepNumber ?? 0, null, decision.recap);
        await this.dependencies.onProgress(input.taskId, progress);
        await this.dependencies.onTerminal(input.taskId, {
          status: 'completed',
          finalOutput: decision.recap,
          message: decision.recap,
        });
        this.finish(input.taskId, controller);
        return;
      }

      const grounded = requireGroundedStep(decision, observation);
      progress = progressFrom(input, decision.stepNumber, decision.expectedOutcome, null);
      await this.dependencies.onProgress(input.taskId, progress);
      await this.dependencies.onStatus(input.taskId, 'presenting', decision.instruction);
      const result = await this.dependencies.presenter.presentStep(
        {
          baselineFingerprint: grounded.observation.fingerprint,
          copy: {
            expectedOutcome: decision.expectedOutcome,
            hook: decision.hook,
            instruction: decision.instruction,
            reason: decision.reason,
          },
          language: decision.language,
          screenPoint: grounded.screenPoint,
          target: decision.target,
          taskId: input.taskId,
        },
        {
          observe: (signal) => this.dependencies.observe(input.taskId, signal),
          signal: controller.signal,
        },
      );
      if (result.learnerActivity === 'timed_out') {
        await this.dependencies.onTerminal(input.taskId, {
          status: 'failed',
          finalOutput: null,
          message: 'Coach presentation ended before the learner could continue.',
        });
        this.finish(input.taskId, controller);
        return;
      }
      await this.dependencies.onStatus(input.taskId, 'observing', 'Tro is checking the learner’s change.');
      observation = result.observation ?? await this.dependencies.observe(input.taskId, controller.signal);
    }
  }

  private finish(taskId: string, controller: AbortController): void {
    if (this.active.get(taskId) !== controller) return;
    this.active.delete(taskId);
    this.dependencies.releaseObservationSession(taskId);
    this.dependencies.releaseDecisionSession?.(taskId);
    this.dependencies.presenter.finishSession(taskId);
  }
}

function progressFrom(
  input: CoachRuntimeStart,
  stepNumber: number,
  expectedOutcome: string | null,
  recap: string | null,
): CoachProgress {
  return {
    attemptId: input.activity?.attemptId ?? null,
    activityVersionId: input.activity?.activityVersionId ?? null,
    stepNumber,
    expectedOutcome,
    recap,
  };
}

function requireGroundedStep(
  decision: Extract<CoachDecision, { kind: 'coach_step' }>,
  observation: DesktopObservation | null,
): {
  observation: DesktopObservation;
  screenPoint: { x: number; y: number };
} {
  if (!observation || !observation.coordinateSpace) {
    throw new Error('Coach returned a visible step without coordinate evidence.');
  }
  if (
    decision.observationId !== observation.observationId ||
    decision.observationFingerprint !== observation.fingerprint
  ) {
    throw new Error('Coach returned a stale screen target.');
  }
  const screenshotPoint = mapNormalizedPointToScreenshot(decision.point, observation.coordinateSpace);
  const screenPoint = mapScreenshotPointToDesktop(screenshotPoint, observation.coordinateSpace);
  return { observation, screenPoint };
}

const AgentTurnResponseSchema = z.object({ id: z.string().uuid() }).passthrough();
const COACH_GENERATED_COPY_LIMITS = {
  hook: 36,
  instruction: 76,
  reason: 46,
} as const;

const RawCoachDecisionSchema = z.object({
  kind: z.enum(['answer', 'coach_step', 'complete']),
  text: z.string().max(1_200).nullable(),
  language: z.enum(['en', 'vi']).nullable(),
  stepNumber: z.number().int().min(1).max(100).nullable(),
  hook: z.string().max(50).nullable(),
  instruction: z.string().max(90).nullable(),
  reason: z.string().max(90).nullable(),
  expectedOutcome: z.string().max(160).nullable(),
  target: z.string().max(80).nullable(),
  observationId: z.string().uuid().nullable(),
  observationFingerprint: z.string().regex(/^[a-f0-9]{64}$/u).nullable(),
  point: z.object({ x: z.number().int(), y: z.number().int() }).nullable(),
  recap: z.string().max(240).nullable(),
}).strict();

export interface AuthenticatedCoachDecisionClientOptions {
  accessTokenProvider(): Promise<string>;
  apiBaseUrl: string;
  model?: string;
}

/** Uses the same authenticated Responses/accounting boundary as Heavy Agent. */
export function createAuthenticatedCoachDecisionClient(
  options: AuthenticatedCoachDecisionClientOptions,
): Pick<CoachRuntimeDependencies, 'decide' | 'releaseDecisionSession'> {
  const agentTurns = new Map<string, string>();
  return {
    releaseDecisionSession: (taskId) => {
      agentTurns.delete(taskId);
    },
    decide: async (input, signal) => {
      const token = await options.accessTokenProvider();
      const baseUrl = options.apiBaseUrl.replace(/\/+$/u, '');
      let agentTurnId = agentTurns.get(input.taskId);
      if (!agentTurnId) {
        const reservation = await fetch(`${baseUrl}/v1/agent-turns`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
            'x-trocode-request-id': randomUUID(),
          },
          body: JSON.stringify({ clientTurnId: randomUUID(), taskId: input.taskId }),
          signal,
        });
        if (!reservation.ok) {
          throw new Error(`Could not reserve the Coach model turn (${reservation.status}).`);
        }
        agentTurnId = AgentTurnResponseSchema.parse(await reservation.json()).id;
        agentTurns.set(input.taskId, agentTurnId);
      }
      const response = await fetch(`${baseUrl}/v1/openai/responses`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'x-trocode-agent-turn-id': agentTurnId,
          'x-trocode-task-id': input.taskId,
          'x-trocode-request-id': randomUUID(),
        },
        body: JSON.stringify(coachResponseRequest(input, options.model ?? 'gpt-5.6-luna')),
        signal,
      });
      if (!response.ok) throw new Error(`Coach model request failed (${response.status}).`);
      return normalizeRawDecision(JSON.parse(extractOutputText(await response.json())));
    },
  };
}

function coachResponseRequest(input: CoachDecisionInput, model: string): Record<string, unknown> {
  const observation = input.observation;
  const evidence = observation
    ? [
        {
          type: 'input_text',
          text: JSON.stringify({
            observationId: observation.observationId,
            observationFingerprint: observation.fingerprint,
            route: observation.route,
            surface: observation.surface ?? null,
            visibleText: observation.text.slice(0, 16_000),
            structuredState: observation.structuredState?.slice(0, 24_000) ?? null,
          }),
        },
        ...(observation.screenshot
          ? [{
              type: 'input_image',
              image_url: `data:${observation.screenshot.mimeType};base64,${observation.screenshot.dataBase64}`,
              detail: 'low',
            }]
          : []),
      ]
    : [{ type: 'input_text', text: 'No screen observation is required for this question.' }];
  return {
    model,
    store: false,
    parallel_tool_calls: false,
    tools: [],
    max_output_tokens: 1_200,
    input: [
      {
        role: 'system',
        content: [{
          type: 'input_text',
          text: `You are Tro, a warm primary-school teacher. Return exactly one JSON decision. Never click, type, or claim an unobserved result. With screen evidence, choose one tight visible control, return its exact center point, and give one short learner action; never estimate overlay size. Complete only when the evidence proves completion. Use normalized 0-1000 screenshot coordinates. Keep spoken copy lively and brief: hook at most ${COACH_GENERATED_COPY_LIMITS.hook} characters, instruction at most ${COACH_GENERATED_COPY_LIMITS.instruction}, reason at most ${COACH_GENERATED_COPY_LIMITS.reason}, and all three together at most ${MAX_COACH_SPEECH_CHARACTERS}. Without screen evidence, answer concisely.`,
        }],
      },
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: JSON.stringify({
              request: input.request,
              priorProgress: input.priorProgress,
              activity: input.activity
                ? {
                    purpose: input.activity.purpose,
                    title: input.activity.activity.title,
                    directive: input.activity.currentDirective,
                    priorProgress: input.activity.priorProgress,
                  }
                : null,
            }),
          },
          ...evidence,
        ],
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'coach_decision',
        strict: true,
        schema: coachDecisionJsonSchema(),
      },
    },
  };
}

function coachDecisionJsonSchema(): Record<string, unknown> {
  const closed = (properties: Record<string, unknown>, required: string[]) => ({
    type: 'object',
    additionalProperties: false,
    properties,
    required,
  });
  const point = closed({
    x: { type: 'integer', minimum: 0, maximum: 1_000 },
    y: { type: 'integer', minimum: 0, maximum: 1_000 },
  }, ['x', 'y']);
  const nullable = (schema: Record<string, unknown>) => ({
    anyOf: [schema, { type: 'null' }],
  });
  const properties = {
    kind: { type: 'string', enum: ['answer', 'coach_step', 'complete'] },
    text: nullable({ type: 'string', maxLength: 1_200 }),
    language: nullable({ type: 'string', enum: ['en', 'vi'] }),
    stepNumber: nullable({ type: 'integer', minimum: 1, maximum: 100 }),
    hook: nullable({ type: 'string', maxLength: COACH_GENERATED_COPY_LIMITS.hook }),
    instruction: nullable({ type: 'string', maxLength: COACH_GENERATED_COPY_LIMITS.instruction }),
    reason: nullable({ type: 'string', maxLength: COACH_GENERATED_COPY_LIMITS.reason }),
    expectedOutcome: nullable({ type: 'string', maxLength: 160 }),
    target: nullable({ type: 'string', maxLength: 80 }),
    observationId: nullable({
      type: 'string',
      pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
    }),
    observationFingerprint: nullable({ type: 'string', pattern: '^[a-f0-9]{64}$' }),
    point: nullable(point),
    recap: nullable({ type: 'string', maxLength: 240 }),
  };
  return closed(properties, Object.keys(properties));
}

function normalizeRawDecision(value: unknown): CoachDecision {
  const raw = RawCoachDecisionSchema.parse(value);
  if (raw.kind === 'answer') {
    return CoachDecisionSchema.parse({
      kind: raw.kind,
      text: raw.text,
      language: raw.language,
    });
  }
  if (raw.kind === 'complete') {
    return CoachDecisionSchema.parse({ kind: raw.kind, recap: raw.recap });
  }
  const copy = normalizeGeneratedCoachCopy(raw);
  return CoachDecisionSchema.parse({
    kind: raw.kind,
    stepNumber: raw.stepNumber,
    hook: copy.hook,
    instruction: copy.instruction,
    reason: copy.reason,
    expectedOutcome: raw.expectedOutcome,
    target: raw.target,
    language: raw.language,
    observationId: raw.observationId,
    observationFingerprint: raw.observationFingerprint,
    point: raw.point,
  });
}

function normalizeGeneratedCoachCopy(
  raw: Pick<z.infer<typeof RawCoachDecisionSchema>, 'hook' | 'instruction' | 'reason'>,
): typeof raw {
  return {
    hook: fitCoachCopyField(raw.hook, COACH_GENERATED_COPY_LIMITS.hook),
    instruction: fitCoachCopyField(
      raw.instruction,
      COACH_GENERATED_COPY_LIMITS.instruction,
    ),
    reason: fitCoachCopyField(raw.reason, COACH_GENERATED_COPY_LIMITS.reason),
  };
}

function fitCoachCopyField(value: string | null, maxLength: number): string | null {
  if (value === null) return null;
  const normalized = value.trim().replace(/\s+/gu, ' ');
  if (normalized.length <= maxLength) return normalized;

  const prefix = normalized.slice(0, maxLength - 1).trimEnd();
  const wordBoundary = prefix.lastIndexOf(' ');
  const minimumNaturalBreak = Math.floor(maxLength * 0.6);
  const fitted = wordBoundary >= minimumNaturalBreak
    ? prefix.slice(0, wordBoundary).trimEnd()
    : prefix;
  return `${fitted}…`;
}

function extractOutputText(value: unknown): string {
  if (!value || typeof value !== 'object') throw new Error('Coach returned no response body.');
  const response = value as { output_text?: unknown; output?: unknown };
  if (typeof response.output_text === 'string' && response.output_text.trim()) {
    return response.output_text;
  }
  if (Array.isArray(response.output)) {
    for (const item of response.output) {
      if (!item || typeof item !== 'object') continue;
      const content = (item as { content?: unknown }).content;
      if (!Array.isArray(content)) continue;
      for (const part of content) {
        if (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string') {
          return (part as { text: string }).text;
        }
      }
    }
  }
  throw new Error('Coach returned no structured output.');
}
