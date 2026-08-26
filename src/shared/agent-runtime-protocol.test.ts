import { describe, expect, it } from 'vitest';

import manifest from '../../protocol/agent-runtime.v3.manifest.json';

import {
  AgentRunProjectionV3Schema,
  AgentRuntimeStatusV3Schema,
  validateAgentRunProjectionV3,
} from './agent-runtime-protocol';

describe('canonical agent runtime protocol v3', () => {
  it('accepts the generated negotiation status and rejects unknown fields', () => {
    const status = {
      protocolVersion: 3,
      protocolDigest: manifest.protocolDigest,
      toolCatalogDigest: manifest.toolCatalogDigest,
      supportedReadVersions: [2, 3],
      supportedStartVersions: [3],
      rolloutMode: 'enforce',
      workerRequired: true,
      enabled: true,
    };
    expect(AgentRuntimeStatusV3Schema.parse(status)).toEqual(status);
    expect(() =>
      AgentRuntimeStatusV3Schema.parse({ ...status, guessedState: true }),
    ).toThrow();
  });

  it('makes blocked authoritative, terminal, and non-cancellable', () => {
    const projection = AgentRunProjectionV3Schema.parse({
      state: 'blocked',
      runVersion: 4,
      phase: 'blocked',
      terminal: true,
      availableActions: [],
      waitingOn: null,
      failure: {
        stage: 'tool_execution',
        code: 'effect_outcome_unknown',
        message: 'The action outcome could not be confirmed.',
        retryable: false,
      },
      cancellationSource: null,
    });
    expect(validateAgentRunProjectionV3(projection)).toEqual(projection);
    expect(() =>
      validateAgentRunProjectionV3({
        ...projection,
        terminal: false,
        availableActions: ['cancel'],
      }),
    ).toThrow();
  });

  it('requires typed permission metadata for the permission state', () => {
    expect(() =>
      validateAgentRunProjectionV3({
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
