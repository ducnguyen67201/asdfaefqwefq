import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createCuaSemanticToolDefinitions } from './cua-semantic-agent-tools';
import { RuntimeToolRegistry } from './runtime-tool-registry';

function registry() {
  return new RuntimeToolRegistry(
    createCuaSemanticToolDefinitions({
      semanticAvailable: () => true,
      browserPrepareAvailable: () => true,
    }),
  );
}

const observation = {
  observationId: randomUUID(),
  taskId: randomUUID(),
  capturedAt: '2026-08-19T00:00:00.000Z',
  text: 'Run',
  route: 'window_accessibility' as const,
  surface: { kind: 'code_editor' as const, application: 'Code' },
  elements: [{ ref: 'e1', role: 'button', name: 'Run' }],
  degraded: false,
  fingerprint: 'a'.repeat(64),
};

describe('CUA semantic agent tools', () => {
  it('publishes strict curated tools without raw CUA methods', () => {
    const specs = registry().modelVisibleSpecs();
    expect(specs.map((spec) => spec.name)).toEqual([
      'observe_surface',
      'control_surface',
      'prepare_browser_access',
    ]);
    expect(specs.every((spec) => spec.strict)).toBe(true);
    expect(JSON.stringify(specs)).not.toContain('callTool');
  });

  it('normalizes a public element ref into trusted execution evidence', () => {
    const invocation = registry().resolve(
      {
        callId: 'call-1',
        name: 'control_surface',
        arguments: JSON.stringify({
          observationId: observation.observationId,
          description: 'Run the visible code.',
          target: 'Run',
          command: {
            kind: 'click_element',
            ref: 'e1',
            button: 'left',
            count: 1,
          },
        }),
      },
      { taskId: observation.taskId, latestObservation: observation },
    );
    expect(invocation).toMatchObject({
      kind: 'surface',
      toolId: 'computer.control',
      action: {
        action: 'click_element',
        parameters: {
          publicRef: 'e1',
          role: 'button',
          visibleText: 'Run',
        },
      },
    });
  });

  it('rejects stale observations', () => {
    expect(() =>
      registry().resolve(
        {
          callId: 'call-stale',
          name: 'control_surface',
          arguments: JSON.stringify({
            observationId: randomUUID(),
            description: 'Run.',
            target: null,
            command: {
              kind: 'click_element',
              ref: 'e1',
              button: 'left',
              count: 1,
            },
          }),
        },
        { taskId: observation.taskId, latestObservation: observation },
      ),
    ).toThrow();
  });

  it('forces browser preparation to a system permission action', () => {
    const browserObservation = {
      ...observation,
      surface: {
        kind: 'browser' as const,
        application: 'Chrome',
        deepAccess: 'ready_to_prepare' as const,
      },
    };
    const invocation = registry().resolve(
      {
        callId: 'call-prepare',
        name: 'prepare_browser_access',
        arguments: JSON.stringify({
          observationId: observation.observationId,
          reason: 'Read the active editor accurately.',
        }),
      },
      { taskId: observation.taskId, latestObservation: browserObservation },
    );
    expect(invocation.action).toMatchObject({
      action: 'system_permission',
      toolId: 'browser.prepare',
    });
  });

  it('executes physical actions without policy metadata', () => {
    const tools = registry();
    const controlSpec = tools
      .modelVisibleSpecs()
      .find((tool) => tool.name === 'control_surface');
    expect(controlSpec?.parameters.required).toEqual([
      'observationId',
      'description',
      'target',
      'command',
    ]);
    expect(controlSpec?.parameters.properties).not.toHaveProperty('effect');
    expect(controlSpec?.parameters.properties).not.toHaveProperty('attendees');

    const invocation = tools.resolve(
      {
        callId: 'delete-visible-item',
        name: 'control_surface',
        arguments: JSON.stringify({
          observationId: observation.observationId,
          description: 'Click the visible delete button.',
          target: 'Delete',
          command: {
            kind: 'click_element',
            ref: 'e1',
            button: 'left',
            count: 1,
          },
        }),
      },
      { taskId: observation.taskId, latestObservation: observation },
    );
    expect(invocation.action).toMatchObject({
      action: 'click_element',
      operation: 'click_element',
      toolId: 'computer.control',
    });
    expect(invocation.action).not.toHaveProperty('effect');
  });
});
