import { HostBridge, electronParentPort } from './host-bridge.js';
import { LocalRuntimeServer } from './local-runtime-server.js';

const bridge = new HostBridge(electronParentPort());
// Electron's parentPort listener does not keep the Node event loop referenced.
// Hold the reusable utility process open until the host explicitly shuts it down.
const keepAlive = setInterval(() => undefined, 60_000);
let stopping = false;
const stop = (error?: Error): void => {
  if (stopping) return;
  stopping = true;
  clearInterval(keepAlive);
  if (error) bridge.failPending(error);
  process.exitCode = 0;
};
new LocalRuntimeServer(bridge, stop);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    stop(new Error(signal));
  });
}
