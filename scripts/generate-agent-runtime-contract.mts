import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import {
  AGENT_RUNTIME_PROTOCOL_VERSION,
  AgentRunActionV4Schema,
  AgentRunFailureCodeV4Schema,
  AgentRunFailureStageV4Schema,
  AgentRunPhaseV4Schema,
  AgentRunStateV4Schema,
  AgentRuntimeErrorCodeV4Schema,
  AgentRuntimeProtocolDocumentV4Schema,
  AgentRuntimeRolloutModeV4Schema,
  CancellationSourceV4Schema,
  ComputerPermissionV4Schema,
} from '../src/shared/agent-runtime-protocol.ts';
import {
  HOSTED_TOOL_CONTRACTS,
  assertStrictFunctionSchema,
} from '../src/shared/agent-tool-contracts.ts';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

function compareOrdinal(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => compareOrdinal(left, right))
      .map(([key, child]) => [key, canonicalize(child)]),
  );
}

function jsonBytes(value: unknown): string {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

function digest(bytes: string): string {
  return createHash('sha256').update(bytes, 'utf8').digest('hex');
}

const schema = z.toJSONSchema(AgentRuntimeProtocolDocumentV4Schema, {
  target: 'draft-2020-12',
  unrepresentable: 'throw',
  cycles: 'ref',
  reused: 'inline',
  io: 'input',
});

const schemaDocument = {
  ...schema,
  $id: 'https://tro.app/protocol/agent-runtime.v4.schema.json',
  title: 'Tro canonical agent runtime protocol v4',
};
delete (schemaDocument as Record<string, unknown>)['~standard'];

const tools = [...HOSTED_TOOL_CONTRACTS]
  .sort((left, right) => compareOrdinal(left.toolId, right.toolId))
  .map((contract) => {
    assertStrictFunctionSchema(contract.parameters);
    return contract;
  });
const toolCatalogDocument = {
  schemaVersion: AGENT_RUNTIME_PROTOCOL_VERSION,
  tools,
};

const schemaContent = jsonBytes(schemaDocument);
const toolCatalogContent = jsonBytes(toolCatalogDocument);
const protocolDigest = digest(schemaContent);
const toolCatalogDigest = digest(toolCatalogContent);

const manifestDocument = {
  schemaVersion: AGENT_RUNTIME_PROTOCOL_VERSION,
  generatorVersion: 1,
  protocolDigest,
  toolCatalogDigest,
  sourceFiles: [
    'src/shared/agent-runtime-protocol.ts',
    'src/shared/agent-tool-contracts.ts',
  ],
  inventories: {
    actions: AgentRunActionV4Schema.options,
    cancellationSources: CancellationSourceV4Schema.options,
    errorCodes: AgentRuntimeErrorCodeV4Schema.options,
    failureCodes: AgentRunFailureCodeV4Schema.options,
    failureStages: AgentRunFailureStageV4Schema.options,
    phases: AgentRunPhaseV4Schema.options,
    permissions: ComputerPermissionV4Schema.options,
    rolloutModes: [AgentRuntimeRolloutModeV4Schema.value],
    states: AgentRunStateV4Schema.options,
    toolIds: tools.map((tool) => tool.toolId),
  },
};

const validStatusFixture = {
  protocolVersion: 4,
  protocolDigest,
  toolCatalogDigest,
  supportedReadVersions: [2, 3, 4],
  supportedStartVersions: [4],
  rolloutMode: 'enforce',
  workerRequired: true,
  enabled: true,
};

const openUrlFixture = {
  name: 'open_url',
  arguments: {
    url: 'https://www.youtube.com/',
    reason: 'Open YouTube.',
  },
  expected: {
    toolId: 'browser.navigate',
    operation: 'open_url',
    prerequisites: [],
  },
};

const outputs = new Map<string, string>([
  ['protocol/agent-runtime.v4.schema.json', schemaContent],
  ['protocol/agent-tools.v4.json', toolCatalogContent],
  [
    'protocol/agent-runtime.v4.manifest.json',
    jsonBytes(manifestDocument),
  ],
  [
    'test/fixtures/agent-runtime-v4/status.valid.json',
    jsonBytes(validStatusFixture),
  ],
  [
    'test/fixtures/agent-runtime-v4/status.unknown-field.invalid.json',
    jsonBytes({ ...validStatusFixture, guessedState: true }),
  ],
  [
    'test/fixtures/agent-runtime-v4/open-url.valid.json',
    jsonBytes(openUrlFixture),
  ],
]);

async function writeOutputs(): Promise<void> {
  for (const [relativePath, content] of outputs) {
    const absolutePath = path.join(repositoryRoot, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, 'utf8');
  }
}

async function checkOutputs(): Promise<void> {
  const stale: string[] = [];
  for (const [relativePath, expected] of outputs) {
    const absolutePath = path.join(repositoryRoot, relativePath);
    const actual = await readFile(absolutePath, 'utf8').catch(() => null);
    if (actual !== expected) stale.push(relativePath);
  }
  if (stale.length > 0) {
    throw new Error(
      `Agent runtime contract artifacts are stale: ${stale.join(', ')}. Run npm run agent:protocol:generate.`,
    );
  }
}

const mode = process.argv[2];
if (mode === '--write') {
  await writeOutputs();
} else if (mode === '--check') {
  await checkOutputs();
} else {
  throw new Error('Use --write or --check.');
}
