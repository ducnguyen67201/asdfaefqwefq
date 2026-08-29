import { createServer } from 'node:http';

import { loadConfig } from './config.js';
import { RunWorker } from './run-worker.js';

const shutdown = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => shutdown.abort(new Error(signal)));
}

const config = loadConfig();
let ready = false;
const health = createServer((request, response) => {
  if (request.method !== 'GET' || request.url !== '/healthz') {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(ready ? 200 : 503, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ ready }));
});
health.listen(config.healthPort, '0.0.0.0');
shutdown.signal.addEventListener('abort', () => health.close(), { once: true });

const worker = new RunWorker(config);
worker.start(shutdown.signal, () => {
  ready = true;
}).catch((error: unknown) => {
  ready = false;
  console.error('agent_runtime_worker_failed', error instanceof Error ? error.message : 'unknown');
  process.exitCode = 1;
  health.close();
});
