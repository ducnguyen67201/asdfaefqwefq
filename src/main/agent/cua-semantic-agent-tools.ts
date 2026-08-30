import { z } from 'zod';

import {
  hostedToolContractById,
  objectSchema,
} from '../../shared/agent-tool-contracts';
import {
  ProposedActionSchema,
  type ProposedAction,
} from '../../shared/contracts';

import type {
  AgentToolCall,
  ResolvedToolInvocation,
  StrictJsonObjectSchema,
} from './agent-contracts';
import {
  SurfaceCommandSchema,
  type DesktopObservation,
  type SurfaceCommand,
  type SurfaceElement,
} from './execution-contracts';
import type {
  RuntimeToolDefinition,
  ToolResolutionContext,
} from './runtime-tool-registry';

const ModelSurfaceCommandSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('click_element'),
    ref: z.string().regex(/^e[1-9][0-9]{0,3}$/u),
    button: z.enum(['left', 'right']),
    count: z.number().int().min(1).max(2),
  }),
  z.object({
    kind: z.literal('type_text'),
    ref: z.string().regex(/^e[1-9][0-9]{0,3}$/u),
    text: z.string().max(100_000),
    replace: z.boolean(),
  }),
  z.object({
    kind: z.literal('press_key'),
    ref: z.string().regex(/^e[1-9][0-9]{0,3}$/u).nullable(),
    key: z.string().trim().min(1).max(40),
    modifiers: z.array(z.string().trim().min(1).max(40)).max(8),
  }),
  z.object({
    kind: z.literal('scroll'),
    ref: z.string().regex(/^e[1-9][0-9]{0,3}$/u).nullable(),
    direction: z.enum(['up', 'down', 'left', 'right']),
    amount: z.number().int().min(1).max(20),
  }),
]);

const SurfaceControlInputSchema = z.object({
  observationId: z.string().uuid(),
  description: z.string().trim().min(1).max(2_000),
  target: z.string().trim().min(1).max(8_000).nullable(),
  command: ModelSurfaceCommandSchema,
});

const ObserveSurfaceInputSchema = z.object({
  reason: z.string().trim().min(1).max(500).optional(),
  query: z.string().trim().min(1).max(500).nullable().optional(),
  observationId: z.string().uuid().optional(),
  region: z.object({
    x: z.number().int().min(0).max(999),
    y: z.number().int().min(0).max(999),
    width: z.number().int().min(1).max(1_000),
    height: z.number().int().min(1).max(1_000),
  }).strict().optional(),
}).superRefine((value, context) => {
  const inspecting = Boolean(value.observationId || value.region);
  if (inspecting !== Boolean(value.observationId && value.region)) {
    context.addIssue({ code: 'custom', message: 'Image inspection requires observationId and region.' });
  }
  if (!inspecting && !value.reason) {
    context.addIssue({ code: 'custom', message: 'Surface observation requires a reason.' });
  }
});

const PrepareBrowserInputSchema = z.object({
  observationId: z.string().uuid(),
  reason: z.string().trim().min(1).max(2_000),
});

export interface ObserveSurfaceToolInput {
  observationId?: string;
  query?: string;
  reason?: string;
  region?: { height: number; width: number; x: number; y: number };
}

export interface SurfaceControlToolInput {
  command: SurfaceCommand;
  description: string;
  observationFingerprint: string;
  observationId: string;
  publicRef?: string;
  target?: string;
}

export interface PrepareBrowserAccessToolInput {
  observationFingerprint: string;
  observationId: string;
  reason: string;
}

export interface CuaSemanticToolOptions {
  browserPrepareAvailable: () => boolean;
  semanticAvailable: () => boolean;
}

const nullableRef = {
  anyOf: [
    { type: 'string', pattern: '^e[1-9][0-9]{0,3}$' },
    { type: 'null' },
  ],
};

const clickModelSchema = objectSchema(
  {
    kind: { type: 'string', const: 'click_element' },
    ref: { type: 'string', pattern: '^e[1-9][0-9]{0,3}$' },
    button: { type: 'string', enum: ['left', 'right'] },
    count: { type: 'integer', minimum: 1, maximum: 2 },
  },
  ['kind', 'ref', 'button', 'count'],
);
const typeModelSchema = objectSchema(
  {
    kind: { type: 'string', const: 'type_text' },
    ref: { type: 'string', pattern: '^e[1-9][0-9]{0,3}$' },
    text: { type: 'string', maxLength: 100_000 },
    replace: { type: 'boolean' },
  },
  ['kind', 'ref', 'text', 'replace'],
);
const keyModelSchema = objectSchema(
  {
    kind: { type: 'string', const: 'press_key' },
    ref: nullableRef,
    key: { type: 'string', minLength: 1, maxLength: 40 },
    modifiers: {
      type: 'array',
      maxItems: 8,
      items: { type: 'string', minLength: 1, maxLength: 40 },
    },
  },
  ['kind', 'ref', 'key', 'modifiers'],
);
const scrollModelSchema = objectSchema(
  {
    kind: { type: 'string', const: 'scroll' },
    ref: nullableRef,
    direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] },
    amount: { type: 'integer', minimum: 1, maximum: 20 },
  },
  ['kind', 'ref', 'direction', 'amount'],
);

function controlParameters(): StrictJsonObjectSchema {
  return objectSchema(
    {
      observationId: { type: 'string' },
      description: { type: 'string', maxLength: 2_000 },
      target: {
        anyOf: [{ type: 'string', maxLength: 8_000 }, { type: 'null' }],
      },
      command: {
        anyOf: [
          clickModelSchema,
          typeModelSchema,
          keyModelSchema,
          scrollModelSchema,
        ],
      },
    },
    ['observationId', 'description', 'target', 'command'],
  );
}

function parseJson<T>(schema: z.ZodType<T>, value: string): T {
  return schema.parse(JSON.parse(value));
}

function requireSemanticObservation(
  context: ToolResolutionContext,
  observationId: string,
): DesktopObservation {
  const observation = context.latestObservation;
  if (!observation) {
    throw new Error('Observe the current surface before requesting a semantic action.');
  }
  if (observation.observationId !== observationId) {
    throw new Error('The semantic tool call references a stale observation.');
  }
  if (
    observation.route !== 'browser_semantic' &&
    observation.route !== 'window_accessibility' &&
    observation.route !== 'window_vision'
  ) {
    throw new Error('The latest observation requires desktop control instead.');
  }
  return observation;
}

function elementFor(
  observation: DesktopObservation,
  publicRef: string | undefined,
): SurfaceElement | undefined {
  if (!publicRef) return undefined;
  const element = observation.elements?.find((candidate) => candidate.ref === publicRef);
  if (!element) throw new Error('The semantic element reference is unavailable.');
  return element;
}

function trustedActionForCommand(command: SurfaceCommand): ProposedAction['action'] {
  return command.kind;
}

function normalizeCommand(
  command: z.infer<typeof ModelSurfaceCommandSchema>,
): SurfaceCommand {
  switch (command.kind) {
    case 'click_element':
      return SurfaceCommandSchema.parse({
        kind: command.kind,
        ref: command.ref,
        button: command.button,
        count: command.count,
      });
    case 'type_text':
      return SurfaceCommandSchema.parse({
        kind: command.kind,
        ref: command.ref,
        text: command.text,
        replace: command.replace,
      });
    case 'press_key':
      return SurfaceCommandSchema.parse({
        kind: command.kind,
        ref: command.ref,
        key: command.key,
        modifiers: command.modifiers,
      });
    case 'scroll':
      return SurfaceCommandSchema.parse({
        kind: command.kind,
        ref: command.ref,
        direction: command.direction,
        amount: command.amount,
      });
  }
}

function actionParameters(
  observation: DesktopObservation,
  element: SurfaceElement | undefined,
  command: SurfaceCommand,
): Record<string, string | string[]> {
  const parameters: Record<string, string | string[]> = {
    command: command.kind,
    application: observation.surface?.application ?? 'Unknown application',
    observationFingerprint: observation.fingerprint,
    observationId: observation.observationId,
    surfaceKind: observation.surface?.kind ?? 'native_app',
    ...(element
      ? {
          publicRef: element.ref,
          role: element.role,
          ariaLabel: element.name,
          visibleText: element.name,
          ...(element.value ? { controlValue: element.value } : {}),
          ...(element.href ? { href: element.href } : {}),
          ...(element.disabled !== undefined
            ? { disabled: String(element.disabled) }
            : {}),
          ...(element.selected !== undefined
            ? { selected: String(element.selected) }
            : {}),
        }
      : {}),
  };
  if (command.kind === 'type_text') parameters.text = command.text;
  if (command.kind === 'press_key') {
    parameters.key = command.key;
    parameters.modifiers = command.modifiers;
  }
  if (command.kind === 'scroll') {
    parameters.direction = command.direction;
    parameters.amount = String(command.amount);
  }
  return parameters;
}

export function createCuaSemanticToolDefinitions(
  options: CuaSemanticToolOptions,
): RuntimeToolDefinition[] {
  const definitions: RuntimeToolDefinition[] = [
    {
      id: 'computer.observe',
      modelName: 'observe_surface',
      description:
        'Read the current non-Tro browser tab or application window using structured semantics first. It returns opaque element references and falls back to vision when needed.',
      operations: ['observe', 'inspect_surface_region'],
      available: options.semanticAvailable,
      parameters: objectSchema(
        {
          reason: { type: 'string', maxLength: 500 },
          query: {
            anyOf: [{ type: 'string', maxLength: 500 }, { type: 'null' }],
          },
          observationId: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
          },
          region: {
            anyOf: [
              {
                type: 'object',
                properties: {
                  x: { type: 'integer', minimum: 0, maximum: 999 },
                  y: { type: 'integer', minimum: 0, maximum: 999 },
                  width: { type: 'integer', minimum: 1, maximum: 1000 },
                  height: { type: 'integer', minimum: 1, maximum: 1000 },
                },
                required: ['x', 'y', 'width', 'height'],
                additionalProperties: false,
              },
              { type: 'null' },
            ],
          },
        },
        ['reason', 'query', 'observationId', 'region'],
      ),
      parse: (value) => {
        const parsed = parseJson(ObserveSurfaceInputSchema, value);
        return {
          ...(parsed.reason ? { reason: parsed.reason } : {}),
          ...(parsed.query ? { query: parsed.query } : {}),
          ...(parsed.observationId ? { observationId: parsed.observationId } : {}),
          ...(parsed.region ? { region: parsed.region } : {}),
        } satisfies ObserveSurfaceToolInput;
      },
      normalize: (input: ObserveSurfaceToolInput, call: AgentToolCall) => ({
        callId: call.callId,
        input,
        kind: 'observe',
        modelName: call.name,
        operation: input.observationId ? 'inspect_surface_region' : 'observe',
        toolId: 'computer.observe',
      }),
    },
    {
      id: 'computer.control',
      modelName: 'control_surface',
      description:
        'Execute one exact click, type, key, or scroll action using an opaque ref from the latest observe_surface result. Set description to one concise user-facing sentence stating what will happen; the host shows it immediately before execution. Use desktop control only when the observation route is desktop vision.',
      operations: ['click_element', 'type_text', 'press_key', 'scroll'],
      available: options.semanticAvailable,
      parameters: controlParameters(),
      parse: (value) => parseJson(SurfaceControlInputSchema, value),
      normalize: (
        input: z.infer<typeof SurfaceControlInputSchema>,
        call: AgentToolCall,
        context: ToolResolutionContext,
      ): ResolvedToolInvocation => {
        const observation = requireSemanticObservation(context, input.observationId);
        const command = normalizeCommand(input.command);
        const publicRef = 'ref' in command && command.ref ? command.ref : undefined;
        const element = elementFor(observation, publicRef);
        const action = ProposedActionSchema.parse({
          action: trustedActionForCommand(command),
          toolId: 'computer.control',
          operation: command.kind,
          description: input.description,
          ...(input.target ? { target: input.target } : {}),
          parameters: actionParameters(observation, element, command),
        });
        return {
          action,
          callId: call.callId,
          input: {
            command,
            description: input.description,
            observationFingerprint: observation.fingerprint,
            observationId: observation.observationId,
            ...(publicRef ? { publicRef } : {}),
            ...(input.target ? { target: input.target } : {}),
          } satisfies SurfaceControlToolInput,
          kind: 'surface',
          modelName: call.name,
          operation: command.kind,
          toolId: 'computer.control',
        };
      },
    },
    {
      id: 'browser.prepare',
      modelName: 'prepare_browser_access',
      description:
        'Prepare CUA access to the exact current logged-in Chromium profile when observe_surface reports that deeper browser access is ready to prepare.',
      operations: ['attach_existing_profile'],
      available: () =>
        options.semanticAvailable() && options.browserPrepareAvailable(),
      parameters: objectSchema(
        {
          observationId: { type: 'string' },
          reason: { type: 'string', maxLength: 2_000 },
        },
        ['observationId', 'reason'],
      ),
      parse: (value) => parseJson(PrepareBrowserInputSchema, value),
      normalize: (
        input: z.infer<typeof PrepareBrowserInputSchema>,
        call: AgentToolCall,
        context: ToolResolutionContext,
      ) => {
        const observation = requireSemanticObservation(context, input.observationId);
        if (
          observation.surface?.kind !== 'browser' ||
          observation.surface.deepAccess !== 'ready_to_prepare'
        ) {
          throw new Error(
            'The current observation is not ready for browser-profile preparation.',
          );
        }
        return {
          action: ProposedActionSchema.parse({
            action: 'system_permission',
            toolId: 'browser.prepare',
            operation: 'attach_existing_profile',
            description: input.reason,
            target: observation.surface.application,
            parameters: {
              observationId: observation.observationId,
              observationFingerprint: observation.fingerprint,
              surfaceKind: observation.surface.kind,
            },
          }),
          callId: call.callId,
          input: {
            observationId: observation.observationId,
            observationFingerprint: observation.fingerprint,
            reason: input.reason,
          } satisfies PrepareBrowserAccessToolInput,
          kind: 'surface' as const,
          modelName: call.name,
          operation: 'attach_existing_profile',
          toolId: 'browser.prepare',
        };
      },
    },
  ];
  return definitions.map((definition) => {
    const contract = hostedToolContractById(definition.id);
    if (!contract) {
      throw new Error(`Runtime tool ${definition.id} is missing from the hosted catalog.`);
    }
    return {
      ...definition,
      description: contract.description,
      modelName: contract.modelName,
      operations: contract.operations,
      parameters: contract.parameters,
    };
  });
}
