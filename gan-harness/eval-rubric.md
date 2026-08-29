# Evaluation rubric

### Design Quality (weight: 0.35)

- The selected mode is legible at a glance without opening Tro.
- Teal and gold match the existing voice controls and Voice Island.
- The mark remains crisp and recognizable at menu-bar scale.

### Originality (weight: 0.30)

- Voice-mode state is encoded in the existing Tro identity without adding persistent UI clutter.
- The treatment feels intentional rather than like a generic notification badge.

### Craft (weight: 0.25)

- Startup, preference changes, sign-out, and shutdown cannot leave stale state.
- A tooltip supplies a non-color cue.
- The implementation is repository-scoped, deterministic, and tested.

### Functionality (weight: 0.10)

- Write my words maps to teal and Ask Tro maps to gold.
- Focused and global mode changes update the same saved preference and tray state.
- Existing tray reveal/quit behavior and global shortcuts still work.

Pass threshold: 7.5/10.
