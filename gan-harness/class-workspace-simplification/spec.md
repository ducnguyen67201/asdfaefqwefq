# Simplify the class workspace UI

## Brief

Redesign the Teacher-facing class workspace shown in the supplied screenshot so it is immediately understandable and substantially calmer. The current page repeats navigation and member actions, exposes upload implementation choices too early, uses technical language such as "Knowledge Spaces" and "Content role," and surrounds an empty state with too many controls and borders.

This is a focused first pass on the class-workspace shell and Materials experience. Preserve the existing Tro visual identity and every existing classroom capability; simplify the route through hierarchy, plain language, progressive disclosure, and state-aware actions.

## Product truth

- A class workspace is the durable home for one class.
- Materials are reusable files or folders that Tro may reference in assigned Activities.
- Activities are authored and published separately.
- People is where Teachers manage the roster.
- Adding members must not be duplicated above every tab.

## Required experience

1. The page must clearly identify the selected class by name and call itself a class workspace, not a generic Knowledge Space.
2. Keep a single back action labeled "Classes."
3. Use three understandable sections: Materials, Activities, People.
4. Do not show a global Add members button. Member creation belongs inside People, while a direct link to People may appear only when contextually useful.
5. In an empty Materials state, present one primary action: "Add files." A secondary folder action may sit nearby but must not compete visually.
6. Hide material type/role choices behind an "Upload options" disclosure. Default safely to Reference.
7. Replace technical or infrastructure-heavy copy with teacher language. Explain the consequence: materials help Tro support assigned Activities.
8. Reduce nested borders, oversized empty containers, and ornamental chrome. Use whitespace and typography for hierarchy.
9. Preserve populated, loading, error, read-only Student, keyboard, and responsive behavior.
10. Preserve all existing APIs and backend contracts. This is a frontend UX simplification, not a data-model change.

## Visual direction

- Editorial classroom character: warm paper, ink, Tro yellow, restrained blue-green accents.
- Calm and confident rather than dashboard-like.
- One dominant decision per state.
- Compact class identity header; section navigation should read as navigation, not another form control.
- Empty states should feel purposeful and small, not like a giant disabled panel.
- Avoid generic gradient cards, excessive pills, border soup, and icon-only mystery actions.

## Scope ownership

Primary implementation surfaces:

- `src/renderer/SpaceDetailPage.tsx`
- `src/renderer/SpaceLibrary.tsx`
- related focused tests
- `src/index.css`
- `src/renderer/app-language.ts` only for new visible strings

Do not change the API, database, authentication, or classroom policy.

## Harness configuration

- Maximum iterations: 10
- Passing weighted score: 7.5
- Evaluation mode: live interaction when available, otherwise focused component tests plus rendered markup and screenshots
