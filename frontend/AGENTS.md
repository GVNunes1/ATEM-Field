# ATEM Field frontend

For UI work, use the installed `../.agents/skills/redesign-skill/SKILL.md` (Taste Skill's existing-project workflow). The general `taste-skill` is focused on marketing surfaces; do not force its landing-page patterns onto operational screens.

Read `../design-system/atem-field/TASTE.md` for the current visual direction. It supersedes the older visual examples in MASTER.md where they conflict. Preserve routes, authentication, user roles, API contracts, and operational actions.

Keep the UI modern and uncluttered. Use Geist, the ATEM blue accent, neutral surfaces, consistent spacing, and subtle navigation animations. Respect reduced motion. Lucide remains the installed icon family. Keep additional screen styling in `src/styles/taste.css` and feature-specific styles, with semantic class names.

## Protected field-report output

The user explicitly requires the field-report PDF to remain unchanged. Do not alter its Python generator, templates, assets, PDF routes, payloads, download behavior, or print-specific styles as part of visual work. Keep screen-only styling under `@media screen`. Do not modify service-order business logic for a redesign.

## Verification

Run `npm run build`. Verify navigation and the affected screens on desktop and mobile, with reduced motion. Use isolated fixtures for browser tests of operational actions so no real reservations or reports are created. Report existing lint failures separately from changed-code failures.
