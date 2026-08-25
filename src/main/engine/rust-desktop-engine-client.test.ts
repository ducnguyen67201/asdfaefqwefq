import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { RustDesktopEngineTransport } from './rust-desktop-engine-client';
import {
  resolveRustDesktopEngineCommand,
  RustDesktopEngineClient,
} from './rust-desktop-engine-client';

function fakeTransport(
  request: RustDesktopEngineTransport['request'],
): RustDesktopEngineTransport {
  return {
    request,
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
  };
}

describe('RustDesktopEngineClient', () => {
  it('requires the Rust handshake before returning policy decisions', async () => {
    const request = vi.fn(async (method: string) => {
      if (method === 'health') {
        return {
          engine: 'rust',
          protocolVersion: 1,
          features: [
            'intent_authorization',
            'desktop_policy',
            'google_oauth',
            'voice',
          ],
        };
      }
      return {
        status: 'allowed',
        effect: {
          kind: 'none',
          resourceKind: null,
          reversibility: 'none',
          externality: 'local',
          communication: 'none',
          overwrite: 'none',
          sensitiveDataTransfer: false,
        },
        authorizationSource: 'routine',
        approvalRequired: false,
        consequential: false,
        summary: 'Observed the current surface.',
        nextActions: ['Verify the observation.'],
      };
    });
    const client = new RustDesktopEngineClient({
      transport: fakeTransport(request),
    });

    await expect(client.evaluateAction({
      action: {
        action: 'observe_screen',
        toolId: 'desktop.observe',
        operation: 'observe',
        description: 'Observe the current surface.',
      },
      goal: {} as never,
      proposedEffect: {
        kind: 'none',
        resourceKind: null,
        reversibility: 'none',
        externality: 'local',
        communication: 'none',
        overwrite: 'none',
        sensitiveDataTransfer: false,
      },
      supported: true,
    })).resolves.toMatchObject({
      status: 'allowed',
      authorizationSource: 'routine',
    });
    expect(request.mock.calls.map(([method]) => method)).toEqual([
      'health',
      'policy.evaluate_action',
    ]);
  });

  it('rejects a sidecar that does not advertise every required Rust feature', async () => {
    const client = new RustDesktopEngineClient({
      transport: fakeTransport(vi.fn(async () => ({
        engine: 'rust',
        protocolVersion: 1,
        features: ['desktop_policy'],
      }))),
    });

    await expect(client.start()).rejects.toThrow('intent_authorization');
  });

  it('resolves native packaged binaries and a Cargo development command', () => {
    expect(resolveRustDesktopEngineCommand({
      enginePath: '/opt/tro/trocode-api',
      isPackaged: false,
      repositoryRoot: '/workspace/TroCode',
      resourcesPath: '/unused',
    })).toEqual({
      executable: '/opt/tro/trocode-api',
      args: ['desktop-engine'],
    });
    expect(resolveRustDesktopEngineCommand({
      isPackaged: true,
      platform: 'win32',
      repositoryRoot: '/workspace/TroCode',
      resourcesPath: 'C:\\Tro\\resources',
    })).toEqual({
      executable: path.join('C:\\Tro\\resources', 'trocode-api.exe'),
      args: ['desktop-engine'],
    });
    expect(resolveRustDesktopEngineCommand({
      cargoExecutable: '/opt/cargo/bin/cargo',
      isPackaged: false,
      repositoryRoot: '/workspace/TroCode',
      resourcesPath: '/unused',
    })).toMatchObject({
      executable: '/opt/cargo/bin/cargo',
      cwd: '/workspace/TroCode',
      args: expect.arrayContaining(['desktop-engine']),
    });
  });
});
