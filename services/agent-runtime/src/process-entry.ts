import { HostBridge, electronParentPort } from './host-bridge.js';
import { LocalRuntimeServer } from './local-runtime-server.js';

const bridge = new HostBridge(electronParentPort());
new LocalRuntimeServer(bridge);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    bridge.failPending(new Error(signal));
    process.exitCode = 0;
  });
}
