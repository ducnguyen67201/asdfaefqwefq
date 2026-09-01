# Local OpenAI Agents SDK runtime operations

New desktop tasks are locally authoritative. A bundled Node utility process
runs the pinned OpenAI Agents SDK `Agent` and `Runner`; Electron main owns local
task lifecycle, OS-encrypted SDK state, trusted tools, and the external-effect
journal. Rust remains the authenticated provider, budget, accounting, and
connector boundary.

There is no backend-agent enable flag, hosted SDK worker, worker lease, private
orchestration endpoint, or orchestration service token in the live path.

## Development

Install and verify both JavaScript workspaces:

```bash
npm ci
npm ci --prefix services/agent-runtime
npm --prefix services/agent-runtime run check
```

`npm start` builds `services/agent-runtime/dist/process-entry.js` before Electron
starts. The backend can be started independently without any agent service
token:

```bash
doppler run --project tro-app --config dev -- npm run engine -- serve
```

At sign-in, Electron starts the utility process, validates protocol/SDK/graph
capabilities, and only then sends the current user credential to child memory.
Protocol v2 also validates the admitted CUA catalog through the bundled Agents
SDK before registering tools or allowing a task to start. Sign-out clears the
credential and stops the process.

## State and recovery

New local task state lives beneath Electron's `userData/agent-state/` directory:

- `threads/index.enc` contains bounded thread metadata;
- each thread has an atomically replaced `snapshot.enc`;
- `events.enc` is an encrypted, checksummed, length-delimited event log;
- `invocations.enc` is the exactly-once external-effect journal.

All logical records are Zod-validated before encryption and after decryption.
Files are mode `0600`, directories are mode `0700`, and replacement writes use
same-directory temporary files, fsync, and rename. A torn final event frame is
quarantined; corruption in a complete frame fails closed.

A checkpoint may resume only when protocol, SDK, graph, model, and frozen tool
catalog digests still match. A tool record found in `executing` without a durable
result becomes terminal `unknown`; operators and the runtime must never replay
it automatically.

## Incident checks

- Runtime start failure: verify the packaged `agent-runtime/dist/process-entry.js`
  exists and its health response matches the pinned SDK/protocol versions.
- Authentication failure: sign in again. Never place the device token in an
  environment variable or log; the child receives it only over the typed process
  channel after handshake.
- Provider/network failure: local history remains readable. Start a new model
  turn only after connectivity returns; do not claim offline inference.
- Session/checkpoint mismatch: leave the encrypted state intact and surface a
  version-mismatch recovery error. Do not edit serialized RunState.
- Tool ambiguity: if dispatch may have occurred, preserve `unknown` and inspect
  the external system manually. Do not change it to `failed` or retry.
- OS permission failure: grant Accessibility or Screen Recording in system
  settings, then begin a new safe continuation. This is a technical prerequisite,
  not an approval profile.
- CUA catalog mismatch: reconnect/discover the driver and start a new turn. A
  running turn never expands its frozen catalog.
- CUA catalog degraded: inspect `catalog.tool-quarantined` and
  `catalog.compatibility` logs. Compatible optional tools remain available.
- CUA catalog unavailable: install a compatible driver. Required-tool and
  schema-dialect failures are detected at startup and logged as
  `catalog.required-tool-failed`; do not retry the same task expecting a
  different catalog.

## Legacy hosted history

Terminal historical rows remain read-only through `/v1/legacy-agent-history`.
Nonterminal hosted runs are not imported into local SDK state. Historical SQL
migrations and tables remain immutable; any later archival/drop requires a new
forward migration and retention evidence.

## Packaging and release gates

Forge compiles the utility package and stages its production dependency closure
as an extra resource. The packaged app must not rely on global Node, a repository
checkout, Railway worker files, or development `node_modules`.

Run:

```bash
npm --prefix services/agent-runtime run check
npm run check
npm run package
npm run bazel:check
```

Then inspect the packaged resource for the process entry and `@openai/agents`,
start the app with no hosted worker deployment, complete a local tool turn,
restart the app, and confirm encrypted local history. Review logs and artifacts
for tokens, prompts, model output, tool arguments, screenshots, or RunState.

## Future cloud and multi-agent modes

A future cloud runtime implements the product `AgentRuntimeAdapter` explicitly;
it is never a hidden fallback for a local task. The current graph contains only
`tro.root`. Future native SDK handoffs or agents-as-tools require an eval-backed
use case, a deterministic graph-version bump, bounded lineage/depth, and
per-agent tool-capability tests, but do not require changing the renderer or Rust
provider boundary.
