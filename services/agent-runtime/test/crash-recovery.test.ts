import { describe, expect, it } from 'vitest';

import type { RuntimeConfig } from '../src/config.js';
import type { ToolCheckpointControlPlane } from '../src/control-plane-client.js';
import { RunLease } from '../src/control-plane-client.js';
import {
  ToolExecutionCheckpoint,
  modelToolResult,
  type PendingToolCall,
} from '../src/tool-adapter.js';

const pending: PendingToolCall = {
  arguments: { url: 'https://example.com' },
  callId: 'sdk-call-1',
  catalogDigest: 'a'.repeat(64),
  driverCatalogDigest: null,
  graphVersion: 'b'.repeat(64),
  idempotencyDigest: 'c'.repeat(64),
  operation: 'navigate',
  sdkVersion: '0.17.0',
  toolId: 'browser.navigate',
};

function config(): RuntimeConfig {
  return {
    apiBaseUrl: 'https://api.example.com',
    compactionItemThreshold: 10,
    graphVersion: pending.graphVersion,
    healthPort: 8_788,
    orchestratorProtocolDigest: 'd'.repeat(64),
    pollMs: 500,
    publicProtocolDigest: 'e'.repeat(64),
    releaseVersion: 'test',
    resultPollMs: 500,
    sdkVersion: '0.17.0',
    serviceToken: 'x'.repeat(32),
  };
}

describe('remote tool crash boundary', () => {
  it('returns desktop visual evidence as SDK structured tool output', () => {
    const observationId = '4e49660f-47b2-4e1c-a7f5-b9ea93e4e720';
    expect(modelToolResult({
      data: {
        observation: {
          observationId,
          text: 'Chrome is visible.',
        },
      },
      status: 'confirmed',
      summary: 'Captured a fresh desktop observation.',
      visual: {
        dataBase64: 'aW1hZ2U=',
        detail: 'original',
        mimeType: 'image/png',
        observationId,
      },
    })).toEqual([
      {
        type: 'text',
        text: JSON.stringify({
          status: 'confirmed',
          summary: 'Captured a fresh desktop observation.',
          data: {
            observation: {
              observationId,
              text: 'Chrome is visible.',
            },
          },
        }),
      },
      {
        type: 'image',
        image: { data: 'aW1hZ2U=', mediaType: 'image/png' },
        detail: 'high',
      },
    ]);
  });

  it('always persists SDK state before queueing the external call', async () => {
    const calls: string[] = [];
    const port: ToolCheckpointControlPlane = {
      putCheckpoint: async () => {
        calls.push('checkpoint');
        return 2;
      },
      queueToolCall: async () => {
        calls.push('queue');
        return { invocationId: '609a5174-b898-4fb7-a430-c96030525640', replayed: false };
      },
    };
    const checkpoint = new ToolExecutionCheckpoint(
      port,
      new RunLease(
        '4e49660f-47b2-4e1c-a7f5-b9ea93e4e720',
        '989104b5-ea79-49d5-a125-87930712bd84',
        1,
      ),
      config(),
    );

    await expect(checkpoint.commit(1, 0, '{"state":true}', pending)).resolves.toBe(2);
    expect(calls).toEqual(['checkpoint', 'queue']);
  });

  it('does not queue when the checkpoint cannot commit', async () => {
    let queued = false;
    const port: ToolCheckpointControlPlane = {
      putCheckpoint: async () => {
        throw new Error('crash');
      },
      queueToolCall: async () => {
        queued = true;
        return { invocationId: '609a5174-b898-4fb7-a430-c96030525640', replayed: false };
      },
    };
    const checkpoint = new ToolExecutionCheckpoint(
      port,
      new RunLease(
        '4e49660f-47b2-4e1c-a7f5-b9ea93e4e720',
        '989104b5-ea79-49d5-a125-87930712bd84',
        1,
      ),
      config(),
    );

    await expect(checkpoint.commit(1, 0, '{"state":true}', pending)).rejects.toThrow('crash');
    expect(queued).toBe(false);
  });
});
