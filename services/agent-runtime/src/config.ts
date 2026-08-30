import { createHash } from 'node:crypto';

import { z } from 'zod';

import orchestratorManifest from '../../../protocol/agent-orchestrator.v1.manifest.json' with {
  type: 'json',
};
import publicManifest from '../../../protocol/agent-runtime.v5.manifest.json' with {
  type: 'json',
};

export const AGENTS_SDK_VERSION = '0.17.0' as const;
export const AGENT_GRAPH_VERSION = 1 as const;
export const TOOL_ADAPTER_VERSION = 1 as const;

const EnvironmentSchema = z
  .object({
    PORT: z.coerce.number().int().min(1).max(65_535).default(8_788),
    TROCODE_API_BASE_URL: z.string().url(),
    TROCODE_AGENT_ORCHESTRATOR_SERVICE_TOKEN: z.string().min(32).max(8_192),
    TROCODE_AGENT_RUNTIME_RELEASE_VERSION: z.string().trim().min(1).max(100).default('local'),
    TROCODE_AGENT_RUNTIME_POLL_MS: z.coerce.number().int().min(100).max(30_000).default(500),
    TROCODE_AGENT_RUNTIME_RESULT_POLL_MS: z.coerce
      .number()
      .int()
      .min(100)
      .max(10_000)
      .default(500),
    TROCODE_AGENT_COMPACTION_ITEM_THRESHOLD: z.coerce
      .number()
      .int()
      .min(2)
      .max(10_000)
      .default(80),
  })
  .passthrough();

export interface RuntimeConfig {
  readonly apiBaseUrl: string;
  readonly compactionItemThreshold: number;
  readonly graphVersion: string;
  readonly healthPort: number;
  readonly orchestratorProtocolDigest: string;
  readonly pollMs: number;
  readonly publicProtocolDigest: string;
  readonly releaseVersion: string;
  readonly resultPollMs: number;
  readonly sdkVersion: typeof AGENTS_SDK_VERSION;
  readonly serviceToken: string;
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const parsed = EnvironmentSchema.parse(environment);
  const apiBaseUrl = parsed.TROCODE_API_BASE_URL.replace(/\/+$/u, '');
  return {
    apiBaseUrl,
    compactionItemThreshold: parsed.TROCODE_AGENT_COMPACTION_ITEM_THRESHOLD,
    graphVersion: graphVersion(),
    healthPort: parsed.PORT,
    orchestratorProtocolDigest: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .parse(orchestratorManifest.protocolDigest),
    pollMs: parsed.TROCODE_AGENT_RUNTIME_POLL_MS,
    publicProtocolDigest: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .parse(publicManifest.protocolDigest),
    releaseVersion: parsed.TROCODE_AGENT_RUNTIME_RELEASE_VERSION,
    resultPollMs: parsed.TROCODE_AGENT_RUNTIME_RESULT_POLL_MS,
    sdkVersion: AGENTS_SDK_VERSION,
    serviceToken: parsed.TROCODE_AGENT_ORCHESTRATOR_SERVICE_TOKEN,
  };
}

export function graphVersion(): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        agentGraphVersion: AGENT_GRAPH_VERSION,
        agentsSdkVersion: AGENTS_SDK_VERSION,
        instructions: AGENT_INSTRUCTIONS,
        orchestratorProtocolDigest: orchestratorManifest.protocolDigest,
        publicProtocolDigest: publicManifest.protocolDigest,
        toolAdapterVersion: TOOL_ADAPTER_VERSION,
      }),
    )
    .digest('hex');
}

export const AGENT_INSTRUCTIONS = `You are Tro, an autonomous computer-use agent. Fulfill the user's intent end to end using only the tools advertised for this run.

Use the most direct available tool. Observe current state before making assumptions. After each tool result, decide the next step yourself. Do not ask for approval: tool interruptions are an internal durability mechanism, not a user decision. If a tool reports an unknown outcome, stop; never repeat a possibly completed action. Finish with a concise account of what was achieved or why the goal could not be completed.`;
