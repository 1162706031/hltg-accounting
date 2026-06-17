# ERP Mobile Responsive Design

## Background

The current frontend is a React + Ant Design ERP application built around desktop CRUD workflows. Most pages use a fixed left sider, toolbar filters, Ant Design tables, and modal forms. Mobile support should make the existing web app usable for quick lookup and common handling, without turning complex desktop workflows into a separate mobile product.

## Goal

Make the frontend compatible with mobile screens for:

- Login and authenticated navigation.
- Viewing lists, filtering/searching, paging, and opening details.
- Common actions such as audit operations, stock in/out, simple create/edit forms, and delete confirmations where already available.
- Read-only inspection of complex order details.

Complex multi-line business entry for smelting, outsource processing, reconciliation import, and other wide forms remains primarily a desktop workflow. On mobile, these forms should not break layout, but they do not need to become optimized mobile-first flows.

## Chosen Approach

Use an adaptive admin layout:

- Desktop keeps the current left sider layout.
- Mobile switches to a compact top header with a menu button and drawer navigation.
- Existing tables remain the primary list component, with horizontal scrolling and tighter spacing on narrow screens.
- Existing modals and detail panels become nearly full-screen on mobile.
- Common filter and action areas stack vertically and use full-width controls on mobile.

This approach keeps the implementation focused on shared layout and styling while improving the main mobile use cases.

## Architecture

### App Layout

`frontend/src/components/AppLayout.tsx` becomes responsive:

- Track whether the viewport is mobile using Ant Design `Grid.useBreakpoint`.
- Render the existing `Sider` only on desktop/tablet widths.
- Render a `Drawer` containing the same menu items on mobile.
- Add a mobile header button to open the drawer.
- Keep user identity and logout accessible in the header.
- Preserve current role-based menu filtering and selected-route logic.

### Global Styling

`frontend/src/styles.css` carries the shared responsive behavior:

- Reduce page padding and gaps on small screens.
- Stack `.page-header` contents and make action button groups wrap cleanly.
- Make `.toolbar` controls full-width on mobile, including Ant Design select, input, date picker, and search controls.
- Make Ant Design tables scroll horizontally when their content is wider than the viewport.
- Tighten table, card, modal, and pagination spacing for mobile.
- Make modals and drawer content respect safe viewport width.

### Detail Modal

`frontend/src/components/DetailModal.tsx` should:

- Use responsive modal width.
- Render descriptions as one column on mobile.
- Add horizontal scroll to nested detail tables.

### Pagination

`frontend/src/utils/pagination.ts` should:

- Use simple pagination behavior on small screens.
- Keep size changer and quick jumper for desktop.
- Retain page-size callbacks and total counts.

## Page-Level Adjustments

The implementation should focus on pages that represent the dominant layouts:

- `Login.tsx`: keep existing responsive split-panel behavior and check it still fits narrow screens.
- `Parties.tsx`, `Items.tsx`, `Inventory.tsx`, `Users.tsx`: list/filter/table/modal CRUD pattern.
- `Smelting.tsx`, `Outsource.tsx`, `Procurement.tsx`, `Sales.tsx`: order list and wide modal form pattern.
- `Reconciliation.tsx`, `Payments.tsx`, `Invoices.tsx`: finance summary cards, wide tables, and modal forms.
- `Audit.tsx`, `OperationLogs.tsx`, `InventoryLogs.tsx`: operational list and detail pattern.

Page edits should be minimal and only used where global CSS cannot make controls usable.

## User Experience Rules

- Mobile navigation should never require horizontal scrolling.
- Main content may use horizontal table scrolling when the business data is naturally wide.
- Buttons must remain reachable without overlapping other controls.
- Filter fields should be easy to tap and should not overflow the viewport.
- Detail and edit modals should use most of the screen width on mobile.
- No new mobile-only routes are required.
- No backend API changes are required.

## Error Handling

Existing API and mutation error handling remains unchanged. Responsive changes should not alter request behavior, query keys, permissions, or status transitions.

If a complex desktop form is opened on mobile, the layout should stay usable enough to cancel, read fields, and perform simple edits, but the app does not need to guide the user through an optimized mobile wizard.

## Testing

Run:

- `npm run build` in `frontend`.

Manual checks should cover:

- 390px mobile width: login, app header, drawer menu, logout.
- 390px mobile width: inventory filters, table scroll, stock in/out modal.
- 390px mobile width: parties table, detail modal, expanded balance table.
- 390px mobile width: smelting or outsource order modal does not overflow the viewport.
- 390px mobile width: reconciliation wide table scrolls without breaking surrounding layout.
- Desktop width: sider layout and existing table-heavy workflows still behave as before.

## Out Of Scope

- Native app or PWA installation support.
- Barcode scanning, camera upload, push notifications, or offline workflows.
- Rebuilding tables as mobile cards across every module.
- Redesigning complex smelting/outsource/reconciliation entry as mobile-first step-by-step forms.
- Backend API changes.

## Self-Review

- No unresolved placeholder requirements are present.
- The selected approach matches the confirmed scope: mobile viewing, filtering, and common actions first; complex entry remains desktop-first.
- The design focuses on shared layout and styling, with limited page-specific edits.
- Testing covers both mobile and desktop regression risk.
