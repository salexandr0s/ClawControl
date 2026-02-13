# UI Buttons, Toggles, and Dropdown Menus

This document defines the canonical button, segmented-toggle, and dropdown/menu styles for ClawControl.

## Source of Truth

- `@clawcontrol/ui` `Button` and `buttonLikeClass`
- `@clawcontrol/ui` `SegmentedToggle`
- `@clawcontrol/ui` `SelectDropdown` and `DropdownMenu`
- Legacy CSS classes (`.btn-primary`, `.btn-secondary`) are compatibility-only and should not be used in new code.

## Button Variants

- `primary`
  - Use for main positive action on a surface.
  - Style: progress blue filled (`bg-status-progress`) with light text.
- `secondary`
  - Use for neutral actions.
  - Style: dark background with border and muted text.
- `ghost`
  - Use for low-emphasis actions.
  - Style: transparent background with hover highlight only.
- `danger`
  - Use only for destructive actions (delete, uninstall, hard reject).
  - Style: semantic red emphasis.

## Button Sizes

- `xs`: dense controls and compact toolbars.
- `sm`: default page header actions.
- `md`: modal footer and form actions.
- `icon`: icon-only button layout.

## Segmented Toggles

- `tone="neutral"`
  - Active style: `bg-bg-3 text-fg-0`.
  - Use for tabs/view switches such as Agents/Teams/Stations or List/Hierarchy.
- `tone="accent"`
  - Active style: `bg-status-progress text-white`.
  - Use when the selected state should be emphasized (for example compact layout mode toggles).

## Dropdowns and Menus

- `SelectDropdown`
  - Use for all value selection controls in toolbar, forms, modals, and cards.
  - Tones:
    - `toolbar`: compact filter/sort controls in page headers and toolbars.
    - `field`: standard form/editor controls in panels and modals.
  - Behavior contract:
    - Non-native custom listbox UI (no OS-native `select` popup).
    - Keyboard navigation (`ArrowUp/Down`, `Enter`, `Escape`) and `role="listbox"` / `role="option"`.
    - Search defaults to `search="auto"` and appears for larger option sets.
- `DropdownMenu`
  - Use for action menus (e.g. “New File / New Folder”).
  - Behavior contract:
    - Keyboard navigation and `role="menu"` / `role="menuitem"`.
    - Supports semantic danger menu items for destructive actions only.
    - Supports portal-based rendering to avoid clipping in scroll containers.

## Do / Don't

- Do use `Button` for user-facing actions on pages, drawers, and modal footers.
- Do use `buttonLikeClass` for anchor/label elements that must look like buttons.
- Do use `SegmentedToggle` instead of hand-rolled segmented button groups.
- Do use `SelectDropdown` instead of native `<select>`.
- Do use `DropdownMenu` instead of ad-hoc absolute-positioned menu popovers.
- Don't add new `btn-primary` / `btn-secondary` usage.
- Don't use ad-hoc action classes like `bg-status-info text-white` for non-danger actions.
- Don't introduce new native OS dropdowns for primary app controls.

## Exceptions

- Tiny icon-only utility controls (dismiss, collapse, row affordances) may remain bespoke if they are not primary user actions.
- Semantic status badges are not action buttons and are not covered by this spec.
