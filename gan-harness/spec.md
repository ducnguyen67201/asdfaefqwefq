# Live Classroom UI Design Brief

Design and implement Tro's seamless teacher/student live-classroom flow inside the existing Electron React application.

## Core experience

The interface should feel like a calm classroom control surface, not surveillance software. A teacher prepares an immutable Activity, creates a Room Run, shares a clear room code, sees students enter a lobby, explicitly starts class, previews and broadcasts an exercise or safe URL, handles explicit Help requests, and completes or returns ready work. A student joins with the room code, understands the privacy boundary, optionally consents to automatic opening of pre-published origins, sees a persistent live-session bar, receives a non-disruptive directive banner, asks for Help or Check, explicitly marks work Ready or submits reviewed files, and can Leave without losing work.

## Required screens and states

1. Spaces entry: teacher creation and student room-code join are visually distinct. A participant must not see teacher creation/upload/publish controls.
2. Teacher Activity setup: allowed HTTPS origins, room joining, facilitator confirmation, materials, criteria, and publishing are understandable without backend terminology.
3. Teacher lobby: room code is dominant, expiry/rotation/revoke are clear, roster uses explicit lobby/live/Help/ready/submitted/completed/left states, and Start class is an intentional transition.
4. Teacher directive composer: exercise and link modes, criteria selection, exact preview, delivery explanation, and an explicit Broadcast action. AI may draft but never broadcast.
5. Student session: concise collection disclosure, safe-link consent default off, persistent class context, current instruction, Help, Check, Ready/Submit, and Leave.
6. Student directive banner: instruction and site origin are readable, manual Open/Dismiss never steals focus, and automatic-open status remains visible.
7. Teacher review: Help Resolve and Complete/Return actions identify the exact Attempt and require deliberate clicks.

## Visual direction

- Preserve Tro's warm neutral foundation while introducing a distinctive live-class layer: deep ink, cobalt signal, mint success, and amber attention.
- Use a spatial progression from preparation → lobby → live → review. Prefer generous cards, strong typography, small status rails, and meaningful density over generic admin tables.
- The room code should feel shareable across a classroom. Live state should be unmistakable without flashing or aggressive red.
- Use restrained motion only for state transitions and respect `prefers-reduced-motion`.
- Avoid gradients, glassmorphism, novelty 3D, skeuomorphic school motifs, gamified leaderboards, and monitoring imagery.

## Craft and accessibility

- Responsive at the existing 960px minimum and narrower component widths.
- Full keyboard operation, visible focus, semantic headings, labelled fields, aria-live feedback, and non-color-only state cues.
- English and Vietnamese strings for all critical classroom controls and disclosures.
- No new UI dependency. Use existing React, CSS, shared schemas, and `window.tro` APIs.
- Existing non-classroom Tro flows must remain visually and behaviorally intact.

## Product boundary

Only explicit lifecycle events are shown. Do not suggest that Tro records cursor movement, typing speed, foreground windows, screenshots, or passive “stuck” state. Computer use begins only from an explicit student request or existing approved task path.
