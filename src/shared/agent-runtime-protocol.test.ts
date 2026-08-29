import { describe, expect, it } from 'vitest';

import manifest from '../../protocol/agent-runtime.v4.manifest.json';

import {
  AgentRunProjectionV4Schema,
  AgentRuntimeStatusV4Schema,
  validateAgentRunProjectionV4,
} from './agent-runtime-protocol';

describe('canonical agent runtime protocol v4', () => {
  it('accepts the generated negotiation status and rejects unknown fields', () => {
    const status = {
      protocolVersion: 4,
      protocolDigest: manifest.protocolDigest,
      toolCatalogDigest: manifest.toolCatalogDigest,
      supportedReadVersions: [2, 3, 4],
      supportedStartVersions: [4],
      rolloutMode: 'enforce',
      workerRequired: true,
      enabled: true,
    };
    expect(AgentRuntimeStatusV4Schema.parse(status)).toEqual(status);
    expect(() =>
      AgentRuntimeStatusV4Schema.parse({ ...status, guessedState: true }),
    ).toThrow();
  });

  it('makes blocked authoritative, terminal, and non-cancellable', () => {
    const projection = AgentRunProjectionV4Schema.parse({
      state: 'blocked',
      runVersion: 4,
      phase: 'blocked',
      terminal: true,
      availableActions: [],
      waitingOn: null,
      failure: {
        stage: 'tool_execution',
        code: 'tool_outcome_unknown',
        message: 'The action outcome could not be confirmed.',
        retryable: false,
      },
      cancellationSource: null,
    });
    expect(validateAgentRunProjectionV4(projection)).toEqual(projection);
    expect(() =>
      validateAgentRunProjectionV4({
        ...projection,
        terminal: false,
        availableActions: ['cancel'],
      }),
    ).toThrow();
  });

  it('requires typed permission metadata for the permission state', () => {
    expect(() =>
      validateAgentRunProjectionV4({
        state: 'awaiting_permission',
        runVersion: 2,
        phase: 'awaiting_permission',
        terminal: false,
        availableActions: [
          'open_system_settings',
          'continue_without_computer',
          'cancel',
        ],
        waitingOn: null,
        failure: null,
        cancellationSource: null,
      }),
    ).toThrow();
  });
});
