# Telegram Mini App override

This file overrides `design-system/atem-field/MASTER.md` only for `TelegramDashboardView` and its CSS. All unspecified Master rules still apply.

## Context

- Primary user: field technician using the Telegram WebApp on a phone, sometimes outdoors or while moving between visits.
- Primary jobs: scan upcoming appointments, confirm required standards, reserve the correct asset, and recover from access or network errors.
- Tone: direct, calm, trustworthy, and compact. Operational clarity outranks decorative density.

## Visual direction

- Preserve the deep navy/blue hero and white operational cards already used by the mini app.
- Use orange only as a small brand accent; use ATEM blue for actions, green for confirmed reservations, amber for pending work, and red for errors.
- Keep Inter as the UI font and JetBrains Mono for times, asset tags, and identifiers.
- Avoid decorative blur or scroll reveals. Use subtle opacity/transform feedback within 150-220ms.

## Mobile constraints

- Respect all four `env(safe-area-inset-*)` values for the hero, content edges, and footer.
- Make every icon button, map link, disclosure summary, and reserve action expose at least a 44x44px hit area.
- Keep body and interactive text readable without zoom. Target 16px for body/actions and never use metadata below 12px.
- Allow names, addresses, and equipment labels to wrap or expose the full value; do not hide critical operational text behind ellipsis alone.
- At 375px, keep one clear reading column. At 720px+, constrain content rather than stretching cards edge to edge.
- Verify portrait and landscape layouts, including the Telegram viewport after `WebApp.expand()`.

## Interaction and accessibility

- Keep each appointment disclosure keyboard-operable and announce its expanded state through native `<details>/<summary>` semantics.
- Give async reservation buttons an accessible busy state, disable duplicate submission, and announce success/error notices with an ARIA live region.
- Pair every status color with an icon and text label.
- Refresh must retain visible feedback and must not clear already-readable content during a silent update.
- Reservation confirmation must name both the asset tag and appointment/client. Error copy must include the next recovery action.
- Preserve `prefers-reduced-motion`; spinning progress indicators may continue only when required to communicate active loading.

## Validation sizes

- 375x667 phone portrait
- 667x375 phone landscape
- 430x932 large phone
- 768px and 820px content widths
