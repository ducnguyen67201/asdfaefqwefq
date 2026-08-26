import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import {
  AGENT_RUNTIME_PROTOCOL_VERSION,
  AgentRunActionV3Schema,
  AgentRunFailureCodeV3Schema,
  AgentRunFailureStageV3Schema,
  AgentRunPhaseV3Schema,
  AgentRunStateV3Schema,
  AgentRuntimeErrorCodeV3Schema,
  AgentRuntimeProtocolDocumentV3Schema,
  AgentRuntimeRolloutModeV3Schema,
  CancellationSourceV3Schema,
  ComputerPermissionV3Schema,
} from '../src/shared/agent-runtime-protocol.ts';
import {
  HOSTED_TOOL_CONTRACTS,
  assertStrictFunctionSchema,
} from '../src/shared/agent-tool-contracts.ts';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right, 'en'))
      .map(([key, child]) => [key, canonicalize(child)]),
  );
}

function jsonBytes(value: unknown): string {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

function digest(bytes: string): string {
  return createHash('sha256').update(bytes, 'utf8').digest('hex');
}

const schema = z.toJSONSchema(AgentRuntimeProtocolDocumentV3Schema, {
  target: 'draft-2020-12',
  unrepresentable: 'throw',
  cycles: 'ref',
  reused: 'inline',
  io: 'input',
});

const schemaDocument = {
  ...schema,
  $id: 'https://tro.app/protocol/agent-runtime.v3.schema.json',
  title: 'Tro canonical agent runtime protocol v3',
};
delete (schemaDocument as Record<string, unknown>)['~standard'];

const tools = [...HOSTED_TOOL_CONTRACTS]
  .sort((left, right) => left.toolId.localeCompare(right.toolId, 'en'))
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
    actions: AgentRunActionV3Schema.options,
    cancellationSources: CancellationSourceV3Schema.options,
    errorCodes: AgentRuntimeErrorCodeV3Schema.options,
    failureCodes: AgentRunFailureCodeV3Schema.options,
    failureStages: AgentRunFailureStageV3Schema.options,
    phases: AgentRunPhaseV3Schema.options,
    permissions: ComputerPermissionV3Schema.options,
    rolloutModes: AgentRuntimeRolloutModeV3Schema.options,
    states: AgentRunStateV3Schema.options,
    toolIds: tools.map((tool) => tool.toolId),
  },
};

const validStatusFixture = {
  protocolVersion: 3,
  protocolDigest,
  toolCatalogDigest,
  supportedReadVersions: [2, 3],
  supportedStartVersions: [3],
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
  ['protocol/agent-runtime.v3.schema.json', schemaContent],
  ['protocol/agent-tools.v3.json', toolCatalogContent],
  [
    'protocol/agent-runtime.v3.manifest.json',
    jsonBytes(manifestDocument),
  ],
  [
    'test/fixtures/agent-runtime-v3/status.valid.json',
    jsonBytes(validStatusFixture),
  ],
  [
    'test/fixtures/agent-runtime-v3/status.unknown-field.invalid.json',
    jsonBytes({ ...validStatusFixture, guessedState: true }),
  ],
  [
    'test/fixtures/agent-runtime-v3/open-url.valid.json',
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
