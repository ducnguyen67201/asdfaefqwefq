import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import {
  AGENT_ORCHESTRATOR_PROTOCOL_VERSION,
  AgentOrchestratorProtocolDocumentV1Schema,
} from '../services/agent-runtime/src/protocol.ts';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicManifest = JSON.parse(
  await readFile(path.join(repositoryRoot, 'protocol/agent-runtime.v5.manifest.json'), 'utf8'),
) as { protocolDigest: string };

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]),
  );
}

function jsonBytes(value: unknown): string {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

const schema = z.toJSONSchema(AgentOrchestratorProtocolDocumentV1Schema, {
  target: 'draft-2020-12',
  unrepresentable: 'throw',
  cycles: 'ref',
  reused: 'inline',
  io: 'input',
});
const schemaDocument = {
  ...schema,
  $id: 'https://tro.app/protocol/agent-orchestrator.v1.schema.json',
  title: 'Tro private agent orchestrator protocol v1',
};
delete (schemaDocument as Record<string, unknown>)['~standard'];
const schemaContent = jsonBytes(schemaDocument);
const protocolDigest = createHash('sha256').update(schemaContent).digest('hex');
const manifestContent = jsonBytes({
  schemaVersion: AGENT_ORCHESTRATOR_PROTOCOL_VERSION,
  generatorVersion: 1,
  protocolDigest,
  sourceFiles: ['services/agent-runtime/src/protocol.ts'],
});
const validRegistration = jsonBytes({
  instanceId: '11111111-1111-4111-8111-111111111111',
  protocolVersion: 1,
  protocolDigest,
  publicProtocolDigest: publicManifest.protocolDigest,
  releaseVersion: '0.1.0',
  sdkVersion: '0.17.0',
  graphVersion: 'a'.repeat(64),
});
const outputs = new Map<string, string>([
  ['protocol/agent-orchestrator.v1.schema.json', schemaContent],
  ['protocol/agent-orchestrator.v1.manifest.json', manifestContent],
  ['test/fixtures/agent-orchestrator-v1/worker-registration.valid.json', validRegistration],
  [
    'test/fixtures/agent-orchestrator-v1/worker-registration.unknown-field.invalid.json',
    jsonBytes({ ...JSON.parse(validRegistration), guessedAuthority: true }),
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
    const actual = await readFile(path.join(repositoryRoot, relativePath), 'utf8').catch(
      () => null,
    );
    if (actual !== expected) stale.push(relativePath);
  }
  if (stale.length > 0) {
    throw new Error(
      `Agent orchestrator contract artifacts are stale: ${stale.join(', ')}. Run npm run agent:orchestrator:generate.`,
    );
  }
}

const mode = process.argv[2];
if (mode === '--write') await writeOutputs();
else if (mode === '--check') await checkOutputs();
else throw new Error('Use --write or --check.');
