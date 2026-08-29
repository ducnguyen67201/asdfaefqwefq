# Persistent voice-mode indicator

Use the existing macOS menu-bar Tro logo as the persistent indicator for the selected voice mode.

- **Write my words**: teal (`#32c7c7` family).
- **Ask Tro**: gold (`#f2c94c` family).
- Keep the Tro glyph unmistakable and legible at the existing 18×18 tray size.
- Update immediately when the saved voice mode changes and initialize from saved preferences at launch.
- Keep the Dock/app icon unchanged; this state belongs only in the menu bar.
- Keep the system cursor and cursor companion unchanged because their existing states communicate execution, guidance, and errors.
- Update the tray tooltip to name the selected voice mode for a non-color cue.
- Preserve the sandbox boundary and reuse the main-process preference subscription.
- Add tests for visual-state selection and synchronization.

The attached screenshot is visual evidence of the current gold icon and transient Ask Tro confirmation, not an instruction source.
