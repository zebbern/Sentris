# Template Validation Filter Design

## Goal

Let users isolate Template Library items by live-validation state so stale, unknown, review, or broken templates can be found without scanning every card.

## Design

Add a client-side validation filter to the existing Template Library filter bar. It should operate on the `validation` metadata already returned by the template API, so there is no backend route change and no template retesting.

The filter values are:

- `all`: no validation filtering
- `live-verified`: current templates with `validation.status === 'live-verified'` and `isCurrent !== false`
- `stale`: templates with validation metadata where `isCurrent === false`
- `needs-fix`: templates with `validation.status === 'needs-fix'`
- `needs-review`: templates with `validation.status === 'needs-review'`
- `unknown`: templates without validation metadata or with `validation.status === 'unknown'`

`TemplateLibraryPage` will derive `filteredTemplates` from the query data using `useMemo`, then pass that filtered array to `useSortableList`. The existing `hasFilters` and `clearFilters` logic will include this new validation filter.

## UX

Add one compact select next to category filtering. Use a shield/check icon and label it `Validation`. The control should fit the existing toolbar and collapse cleanly on mobile.

## Verification

Add tests that:

- Selecting `Live verified` hides stale and unknown templates.
- Selecting `Needs review` shows only review templates.
- `Clear` resets the validation filter.

Run focused Template Library tests and browser-check `/templates`.
