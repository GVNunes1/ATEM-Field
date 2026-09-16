# ATEM Field: Taste implementation

## Current direction

Approved brief: modern, clean UI with navigation animations. Operational web product for technical-assistance teams. Preserve the ATEM identity, established routes and workflows, and the exact field-report PDF output.

Use the Taste repository's `redesign-existing-projects` workflow: inspect, diagnose, then improve the existing React + Vite + CSS application. The default `design-taste-frontend` skill excludes dense dashboards; its marketing layouts are not imposed here. This is a custom ATEM design system, not an implementation of Fluent or Carbon.

Settings: design variance 5, motion intensity 4, visual density 5. Lower the visual density through spacing and hierarchy, not by concealing operational data.

## Tokens and composition

- Typography: self-hosted Geist Variable, with JetBrains Mono Variable for asset identifiers. Use tabular figures for metrics. System fonts remain fallbacks.
- Accent: ATEM blue `#175cd3`, hover `#1049ac`, quiet selection `#edf3fd`.
- Neutral base: `#f7f8fa`; surfaces white; text `#1c2637`; muted text `#667185`; borders `#e2e7ee`.
- Semantic green, amber and red remain available for actual operational states, paired with labels.
- Radius: 8px for controls, 14px for surfaces, 16px for dialogs. Badges use 5px.
- Shadows are reserved for floating layers and subtle separation. Avoid glowing actions, gradient banners and decorative cards around every metric.
- The dashboard prioritizes today's appointments, asset availability and recent reservations. Data comes from existing API responses; no fabricated trends, totals or availability claims.
- Keep desktop navigation and existing destination labels. Mobile navigation scrolls horizontally with full hit targets and safe-area padding.
- Desktop content is capped at 1400px. Collapse dashboard columns at 1024px and use touch-friendly layouts below 768px.

## Motion

- Navigation: 260ms opacity and 8px vertical entry on destination changes.
- Active navigation: 240ms indicator transition and restrained icon movement.
- Buttons: 160ms background/press feedback. No perpetual decorative animation.
- `prefers-reduced-motion: reduce` disables destination and navigation animations.
- Animate transforms/opacity; do not animate content dimensions or block interaction.

## Implementation and boundaries

`frontend/src/styles/taste.css` is the screen-only shared visual layer. Existing operational logic stays in its original components. The self-hosted font packages are runtime assets, not a UI framework dependency.

Field-report PDF generation is independent of the web redesign and must remain unchanged, including templates, generator code, routes and payloads. The service-order feature's internal layout is not redesigned by this task.

## Audit findings addressed

- Low-contrast colored dashboard metrics replaced with readable neutral/blue values.
- Repeated gradient cards replaced by a metric strip and a focused asymmetric content grid.
- Static descriptive workflow block replaced with live daily appointments.
- Generic loading and silent API failures replaced with shaped skeletons and contextual error feedback.
- Centered login card evolved into a responsive brand/form composition.
- Active navigation, press feedback, keyboard focus and skip link share predictable behavior.

Source: https://github.com/Leonxlnx/taste-skill (local copies in `.agents/skills/taste-skill` and `.agents/skills/redesign-skill`).

## Verification (2026-09-16)

- Production build passed; targeted ESLint passed for DashboardView, PageSkeleton and Navigation.
- Isolated Chromium fixtures verified seven navigation destinations, reservation handoff, empty/error states and login selection. No live writes were sent.
- Responsive checks passed at 375, 768, 1024 and desktop 1440px; reduced-motion behavior passed. Dashboard and mobile login axe checks reported zero violations.
- Field-report generator, routes and service-order feature have no changes in the diff. PDF generation was not modified or invoked by the visual tests.
