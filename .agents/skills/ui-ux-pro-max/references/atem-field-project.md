# ATEM Field project profile

For the current approved redesign, read `<project-root>/design-system/atem-field/TASTE.md` after MASTER.md. It supersedes the older Inter/gradient visual defaults below with Geist, quiet surfaces and animated navigation. Preserve the field-report PDF exactly.

Load this file only when the workspace is the ATEM Field project. Confirm it by finding `frontend/package.json` with `name: quick-turing-frontend`.

## Product and users

- Product: internal technical-assistance field operations platform for Mult Med Equipamentos Hospitalares, with no commercial offering or software sales.
- Primary users: supervisors, warehouse/asset staff, and field technicians.
- Core jobs: review schedules, assign technicians, reserve analyzers by asset tag, manage checklists, and monitor Telegram/Google Calendar routines.
- Usage: desktop-first operational work with responsive access in the field; dense information must stay scannable and safe under time pressure.
- Language: Brazilian Portuguese. Format dates, times, counts, and status copy for `pt-BR`.

## Technical profile

- Frontend: React 19, TypeScript, and Vite 6 under `frontend/`.
- Styling: global CSS in `frontend/src/index.css`, with some legacy inline styles in page components.
- Icons: Lucide React. Do not introduce emoji as structural icons or mix icon families without a reason.
- Existing brand assets: `frontend/public/logomarca.png` and `frontend/public/icone.png`; preserve proportions and accessible alternative text.
- Do not add GSAP, a component framework, or another font merely because a database result includes it. Respect the installed stack unless the user requests a dependency change.

## Authoritative project design system

Read `<project-root>/design-system/atem-field/MASTER.md` before designing, building, or reviewing UI. Check `design-system/atem-field/pages/<page-name>.md` next; a page file overrides the Master.

The adapted direction is:

- Style: accessible enterprise operations UI with subtle depth, not a consumer medical app.
- Dials: variance 4/10, motion 3/10, density 8/10.
- Brand: primary blue `#175CD3`, supporting teal `#0F766E`, white surfaces, and slate text on `#F4F7FB`.
- Typography: Inter for UI text and headings; JetBrains Mono only for asset tags, IDs, and tabular technical data.
- Motion: CSS transitions and existing reduced-motion handling. Prefer 150-240ms state transitions; no decorative scroll choreography.

If a generated design-system result conflicts with these established project choices, treat it as a candidate and preserve the Master unless the user explicitly approves a redesign.

## Project-specific priorities

1. Accessibility: visible `:focus-visible`, semantic labels, keyboard-operable navigation and dialogs, sequential headings, and non-color status cues.
2. Interaction: minimum 44px targets for primary mobile controls, clear async feedback, and no hover-only action.
3. Responsiveness: verify 375, 768, 1024, and 1440px; prevent horizontal overflow except intentional table wrappers.
4. Operational clarity: one primary action per view; dates, technicians, asset tags, availability, and destructive actions must be unambiguous.
5. Performance: consider virtualization or pagination for the 1,982-appointment and 120-technician datasets; debounce or defer large-list searches.
6. Forms and dialogs: use visible labels, inline recovery-oriented errors, focus entry/return, Escape/cancel routes, and unsaved-change protection where needed.
7. Navigation: preserve the active destination and filter state. Prefer URL-backed screens when changing navigation architecture so operational views can be linked directly.

## Search defaults

Use a multidimensional query such as:

```text
internal healthcare technical assistance field operations asset inventory scheduling professional light responsive data-dense
```

Use `--stack react`. For the base design-system query use variance `4`, motion `3`, and density `8`. Supplement with explicit `ux`, `icons`, `color`, or `chart` domain searches only as the task requires.
