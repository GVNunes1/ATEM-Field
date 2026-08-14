# Design System Master File

> **LOGIC:** When building a specific page, first check `design-system/atem-field/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** ATEM Field
**Generated:** 2026-08-12; adapted to the existing product and brand
**Category:** Internal clinical-engineering operations platform
**Design Dials:** Variance 4/10 (Balanced / Modern) | Motion 3/10 (Subtle) | Density 8/10 (Dense / Dashboard)

This file is the project source of truth. Database search output is advisory; preserve these decisions unless the user explicitly approves a redesign.

---

## Global Rules

### Color Palette

| Role | Hex | CSS Variable |
|------|-----|--------------|
| Primary | `#175CD3` | `--primary` |
| Primary hover | `#0F4FBF` | `--primary-hover` |
| On primary | `#FFFFFF` | `--text-on-accent` |
| Supporting teal | `#0F766E` | `--secondary` |
| Success/accent | `#0E9F6E` | `--accent-teal` |
| Page background | `#F4F7FB` | `--bg-primary` |
| Surface/card | `#FFFFFF` | `--bg-card` |
| Foreground | `#162033` | `--text-main` |
| Secondary text | `#344054` | `--text-secondary` |
| Muted text | `#667085` | `--text-muted` |
| Border | `#DFE7F1` | `--border-color` |
| Destructive | `#DC2626` | `--status-critical` |
| Focus ring | `rgba(23, 92, 211, 0.12)` | semantic focus token |

**Color notes:** Preserve the ATEM blue identity. Use teal/green for supporting and success states, not as a competing primary CTA. Every status must include text or an icon; color alone is insufficient.

### Typography

- **Heading Font:** Inter
- **Body Font:** Inter
- **Technical/Data Font:** JetBrains Mono, limited to asset tags, IDs, and tabular figures
- **Mood:** operational, precise, trustworthy, clean, and accessible
- **Google Fonts:** [Inter + JetBrains Mono](https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;600&display=swap)

**CSS Import:**
```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;600&display=swap');
```

### Spacing Variables

*Density: 8/10 — Dense / Dashboard*

| Token | Value | Usage |
|-------|-------|-------|
| `--space-xs` | `2px` / `0.125rem` | Tight gaps |
| `--space-sm` | `4px` / `0.25rem` | Icon gaps, inline spacing |
| `--space-md` | `8px` / `0.5rem` | Standard padding |
| `--space-lg` | `12px` / `0.75rem` | Section padding |
| `--space-xl` | `16px` / `1rem` | Large gaps |
| `--space-2xl` | `24px` / `1.5rem` | Section margins |
| `--space-3xl` | `32px` / `2rem` | Hero padding |

### Shadow Depths

| Level | Value | Usage |
|-------|-------|-------|
| `--shadow-xs` | `0 1px 2px rgba(16, 24, 40, 0.04)` | Inputs and quiet surfaces |
| `--shadow-sm` | `0 2px 8px rgba(16, 24, 40, 0.06)` | Default cards and navigation |
| `--shadow-md` | `0 10px 30px rgba(16, 24, 40, 0.08)` | Hovered cards and popovers |
| Modal shadow | `0 24px 70px rgba(15, 23, 42, 0.25)` | Dialogs only |

---

## Component Specs

### Buttons

```css
/* Primary Button */
.btn-primary {
  background: linear-gradient(135deg, #2471E8, #175CD3);
  color: white;
  min-height: 42px;
  padding: 10px 18px;
  border-radius: 10px;
  font-weight: 600;
  transition: transform 160ms ease, background 160ms ease, box-shadow 160ms ease;
  cursor: pointer;
}

.btn-primary:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 8px 18px rgba(23, 92, 211, 0.28);
}

/* Secondary Button */
.btn-secondary {
  background: #FFFFFF;
  color: #344054;
  border: 1px solid #DFE7F1;
  min-height: 42px;
  padding: 10px 18px;
  border-radius: 10px;
  font-weight: 600;
  transition: color 160ms ease, border-color 160ms ease, background 160ms ease;
  cursor: pointer;
}

.btn:focus-visible {
  outline: 3px solid rgba(23, 92, 211, 0.22);
  outline-offset: 2px;
}
```

### Cards

```css
.card {
  background: #FFFFFF;
  border: 1px solid #DFE7F1;
  border-radius: 16px;
  padding: 16px;
  box-shadow: var(--shadow-sm);
  transition: border-color 180ms ease, box-shadow 180ms ease, transform 180ms ease;
}

.card[data-interactive='true']:hover {
  box-shadow: var(--shadow-md);
  transform: translateY(-2px);
  cursor: pointer;
}
```

### Inputs

```css
.input {
  min-height: 44px;
  padding: 12px 16px;
  border: 1px solid #CFD9E6;
  border-radius: 9px;
  font-size: 16px;
  transition: border-color 160ms ease, box-shadow 160ms ease;
}

.input:focus-visible {
  border-color: #75A5ED;
  outline: none;
  box-shadow: 0 0 0 3px rgba(23, 92, 211, 0.12);
}
```

### Modals

```css
.modal-overlay {
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
}

.modal {
  background: white;
  border-radius: 16px;
  padding: 32px;
  box-shadow: var(--shadow-xl);
  max-width: 500px;
  width: 90%;
}
```

---

## Style Guidelines

**Style:** Accessible enterprise operations UI with subtle depth

**Keywords:** professional, operational, data-dense, scannable, light, responsive, accessible, subtle depth

**Best For:** Clinical-engineering schedules, field teams, equipment inventory, checklists, and operational status

**Key Effects:** Quiet shadows, consistent borders/radii, 150-240ms state feedback, visible focus, and WCAG AA contrast

### Page Pattern

**Pattern Name:** Responsive operational dashboard

- **Task strategy:** Put current work, exceptions, and status ahead of explanatory content.
- **CTA placement:** One primary action per view; keep global synchronization and navigation distinct from page actions.
- **Page order:** Context/title, key actions, filters/status, operational content, empty/error/help states.

---

## Motion

Use existing CSS transitions; GSAP is not installed and is not needed for this operational product.

- State transitions: 150-240ms, usually `ease-out` on entry and faster on exit.
- Animate only `transform` and `opacity` when possible; never delay access to operational data for a reveal.
- Keep loading indicators immediate and use skeletons for waits over one second.
- Preserve the existing `prefers-reduced-motion` override.

---

## Anti-Patterns (Do NOT Use)

- ❌ Bright neon colors
- ❌ Motion-heavy animations
- ❌ AI purple/pink gradients
- ❌ Consumer-medical cyan rebrand that discards the ATEM identity
- ❌ Decorative scroll choreography or a new animation dependency
- ❌ Raw hex values in new page components when a semantic token exists
- ❌ Emoji as status, navigation, or action icons

### Additional Forbidden Patterns

- ❌ **Emojis as icons** — Use SVG icons (Heroicons, Lucide, Simple Icons)
- ❌ **Missing cursor:pointer** — All clickable elements must have cursor:pointer
- ❌ **Layout-shifting hovers** — Avoid scale transforms that shift layout
- ❌ **Low contrast text** — Maintain 4.5:1 minimum contrast ratio
- ❌ **Instant state changes** — Always use transitions (150-300ms)
- ❌ **Invisible focus states** — Focus states must be visible for a11y

---

## Pre-Delivery Checklist

Before delivering any UI code, verify:

- [ ] No emojis used as icons (use SVG instead)
- [ ] All icons from consistent icon set (Heroicons/Lucide)
- [ ] `cursor-pointer` on all clickable elements
- [ ] Hover states with smooth transitions (150-300ms)
- [ ] Light mode: text contrast 4.5:1 minimum
- [ ] Focus states visible for keyboard navigation
- [ ] `prefers-reduced-motion` respected
- [ ] Responsive: 375px, 768px, 1024px, 1440px
- [ ] No content hidden behind fixed navbars
- [ ] No horizontal scroll on mobile
- [ ] Primary mobile controls provide at least a 44px hit target
- [ ] Dialog focus enters the dialog, stays trapped, closes with Escape/cancel, and returns to the trigger
- [ ] Forms use associated labels and recovery-oriented inline errors
- [ ] Status meaning is not communicated by color alone
- [ ] Long lists are profiled; paginate or virtualize when rendering becomes costly
- [ ] Dates, times, and counts use Brazilian Portuguese formatting
