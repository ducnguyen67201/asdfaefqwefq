# Primary-School Coach Walkthrough

## Summary

Turn the existing narrated pointer walkthrough into a durable, adaptive coaching loop for primary-school students. Tro must observe one current screen, introduce one short grounded action, glide and highlight while ElevenLabs narrates, wait for the learner to act, then re-observe before deciding the next step. Common Vietnamese requests must enter this mode instead of receiving a full answer dump.

## Patterns to Mirror

- Pure walkthrough state and policy: `services/agent-runtime/src/walkthrough-runtime.ts`
- Agents SDK session/checkpoint loop: `services/agent-runtime/src/local-runtime-server.ts`
- Strict tool boundary schemas: `src/main/agent/runtime-tool-registry.ts`
- CUA execution/presentation separation: `src/main/agent/execution-coordinator.ts`
- Narration lifecycle and cancellation: `src/main/voice/companion-narration-service.ts`
- Sandboxed renderer contracts: `src/shared/contracts.ts`, `src/preload.ts`
- Existing guidance callout and reduced-motion CSS: `src/renderer/GuidanceCallout.tsx`, `src/index.css`

## Files to Change

- `services/agent-runtime/src/walkthrough-runtime.ts`
- `services/agent-runtime/src/walkthrough-runtime.test.ts`
- `services/agent-runtime/src/local-runtime-server.ts`
- `services/agent-runtime/src/local-runtime-server.test.ts`
- `src/shared/contracts.ts`
- `src/main/agent/runtime-tool-registry.ts`
- `src/main/agent/runtime-tool-registry.test.ts`
- `src/main/agent/execution-coordinator.ts`
- `src/main/agent/execution-coordinator.test.ts`
- `src/index.ts`
- `src/renderer/GuidanceCallout.tsx`
- `src/renderer/GuidanceCallout.test.tsx`
- `src/index.css`
- New pure coach presentation / learner-gate modules and tests as needed

## Step-by-Step Tasks

1. Add regression coverage and routing for natural Vietnamese visible-task requests such as `Cách làm bài tập Scratch này.`
2. Extend the guidance tool boundary from one prose description to bounded structured coaching copy: hook, action instruction, reason, and expected outcome, while retaining one grounded visible target and no-click semantics.
3. Add a pure walkthrough lifecycle with explicit presenting/waiting/verification phases so guidance completion cannot count as learner completion.
4. Extract a presentation timeline that coordinates the hook, cursor/Tro glide, highlight, action/reason narration, cancellation, and reduced motion without overlapping speech.
5. Add a durable learner-action gate using fresh observation fingerprints plus explicit replay/pause/continue affordances; suspend the model loop while waiting rather than holding an unbounded request open.
6. Re-observe and validate the active surface after learner activity; pause on application mismatch and let the model recover only from fresh evidence.
7. Add primary-school engagement constraints: short localized language, one action and one reason, verified encouragement, captions, replay, pause/resume, and no fabricated total-step count.
8. Add an end-to-end deterministic walkthrough test covering observe, guide, wait, learner change, fresh observe, and next guidance.
9. Create an implementation report and archive this plan after consolidated validation.

## Testing Strategy

- Intent fixtures for English and Vietnamese, including the pasted production phrase.
- Pure state transition tests proving no next observation before learner activity.
- Schema limit and stale-observation tests.
- Fake-clock presentation timing, narration cancellation, and no-overlap tests.
- Screen-fingerprint stability, unchanged-screen, app-switch, timeout, replay, and explicit-continue tests.
- Renderer accessibility, captions, keyboard controls, and reduced-motion tests.
- End-to-end fake CUA and fake narration walkthrough.

## Validation Commands

Run once after all coding is complete:

```bash
npm run check
npm run package
```

Rust/Bazel validation is not required unless Rust, Cargo, Bazel, or Rust CI files change.

## Acceptance Criteria

- Natural visible-task help requests enter walkthrough mode and never dump the full solution upfront.
- Every model-selected step is grounded in the latest observation.
- Tro speaks a short hook, one action, and one reason while cursor motion and highlighting remain synchronized.
- The model cannot advance to another step until learner activity or an explicit learner signal is received.
- A fresh observation is required after learner activity; stale coordinates are never replayed.
- Switching to a different application pauses safely.
- Students can replay, pause/resume, or request a hint without losing the active step.
- Narration never overlaps, captions remain visible, and reduced motion is honored.
- `npm run check` and `npm run package` pass.

## Assessment

- Predicted complexity: High
- Confidence: Medium-high
- Primary risk: durable suspension/resumption of the Agents SDK run while waiting for learner-controlled UI changes
