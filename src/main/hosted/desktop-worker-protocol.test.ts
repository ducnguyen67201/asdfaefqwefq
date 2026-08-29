import { describe, expect, it } from 'vitest';

import { RuntimeToolRegistry } from '../agent/runtime-tool-registry';

import { desktopWorkerCapabilities } from './desktop-worker-protocol';

describe('desktopWorkerCapabilities', () => {
  it('advertises every installed tool while leaving run authority to the backend', () => {
    const registry = new RuntimeToolRegistry();
    const capabilities = desktopWorkerCapabilities(registry);
    const toolIds = capabilities.tools.map((tool) => tool.toolId);

    expect(toolIds).toContain('workspace.filesystem');
    expect(toolIds).toContain('workspace.terminal');
    expect(toolIds).toContain('knowledge.search');
    expect(toolIds).toContain('activity.signal');

    expect(registry.list().map((tool) => tool.id)).not.toContain(
      'workspace.filesystem',
    );
    expect(registry.list().map((tool) => tool.id)).not.toContain(
      'knowledge.search',
    );
  });
});
