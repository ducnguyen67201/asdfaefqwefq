# Potential-Issues Review: PR #57

The repository and installed skills do not define a workflow named “ponytail review.” This artifact records the requested second review as an adversarial potential-issues pass.

## Review Focus

- overlapping desktop captures and idempotent cleanup
- destroyed or logically deactivated Electron windows
- focus stealing through `show`, `focus`, `moveTop`, and completion fallbacks
- Voice Island / task lifecycle event ordering
- observation freshness and stale IDs
- privacy of screenshots, transcripts, structured state, URLs, and element text
- unknown tool outcomes and replay safety
- Workspace authority isolation
- semantic-unavailable and permission-denied fallback behavior

## Results

### Resolved

- Desktop fallback could have run without a preparation guard when a coordinator omitted the optional callback. It now fails closed before capture.
- Workspace visible-context isolation had no direct task-boundary test. Coverage now prevents future accidental screen grants.
- A required first tool name did not constrain the first operation or observation scope. The exact `observe + auto` call is now normalized before checkpointing, verified again at the Electron boundary, and persisted across restart/resume.

### Verified

- Capture leases serialize transitions and restore windows only after the final release.
- Cleanup is idempotent and skips destroyed or no-longer-active surfaces.
- Main, guidance, and stale control surfaces are not reactivated by desktop cleanup.
- Surface success bypasses desktop preparation and capture.
- Desktop failure still releases the capture lease exactly once.
- Task voice `committing` and stale `complete` states yield to task thinking/working.
- `done + nonterminal task` cannot mutate companion state or reveal the main window.
- Observation images and structured evidence are sent to the model but not added to logs or analytics.
- Unknown execution outcomes retain the existing no-replay behavior.
- Workspace tasks do not receive the required screen-observation tool.
- The first screen-grounding call cannot be changed into region inspection or direct desktop capture by model-supplied arguments.
- Named provider tool choice is restricted to an exact function in the submitted catalog; unsupported choices fail closed with a stable code.
- Request diagnostics expose only bounded correlation and structural metadata, not prompts, credentials, tool schemas, screenshots, or results.
- Voice Task submission can disable new recording without cancelling the turn that is already committing.
- Pending pre-restart tool interruptions reconcile with Electron's invocation journal: undispatched calls re-ground, completed results replay, and executing calls become unknown without redispatch.
- Journaled screen observations are recaptured after restart because their opaque CUA bindings cannot be safely rehydrated from persisted model output.

## Open Items

No code-level blocker remains. A packaged build passed; the real Scratch foreground flow, semantic-disabled desktop fallback, and macOS permission denial should still be exercised manually.

---

## Follow-up Potential-Issues Pass: Narrated teacher walkthrough

No release-blocking code issue remains after the correction-budget fix.

### Non-blocking risks to verify

1. Native Scratch smoke testing still depends on macOS Screen Recording and
   Accessibility permissions plus live ElevenLabs credentials; CI cannot prove
   those integrations end to end.
2. If ElevenLabs fails, the existing system-speech fallback is used. If both
   speech backends fail, the pointer, marker, and callout remain visible, but
   the lesson is silent.
3. The classifier deliberately requires visible/deictic how-to language to
   avoid turning ordinary explanation requests into screen capture. Monitor
   real requests for false positives and false negatives.
4. The current model sample ceiling supports roughly twenty observation / show
   cycles. That covers the requested approximately eleven steps, but much
   longer lessons will need an explicit continuation strategy.
5. The CUA pointer moves first, then the companion glides to the target, then
   the marker and narration appear. This preserves the existing cursor-buddy
   ownership model and avoids speaking before arrival, but perceived pacing
   should be tuned with a real Scratch walkthrough.

### Safety properties rechecked

- Teacher mode points and explains; it does not click or mutate the learner's app.
- Only one target is revealed per fresh observation.
- Reduced Motion eliminates the glide without changing the teaching sequence.
- Walkthrough phase is schema-validated and survives encrypted checkpoint resume.
- Unknown tool outcomes retain the existing no-replay rule.
