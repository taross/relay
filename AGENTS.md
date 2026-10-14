# Repository UI rules

Before changing the product UI, read `docs/ui-design-system.md` and preserve its visual language.

- Do not introduce generic dashboard decoration such as active-item side rails, dot/square ornaments, oversized pills, or rounded navigation cards.
- Do not use underlines or bottom borders to indicate active navigation. Use type weight, text color, and a quiet surface change.
- Reuse the radius and surface tokens defined in `src/style.css`; do not add one-off corner radii for ordinary controls or panels.
- Never set visible product text below `--font-min` (11px). Rework spacing or layout instead of shrinking text.
- Separators must communicate structure. Do not add lines solely for decoration.
- Keep operational labels tied to the release-management domain. Avoid marketing copy and ornamental headings.
- Write approval blockers and constraints as complete sentences with an actor, required state or action, and timing/threshold where applicable. Never place a verification procedure in the constraints list.
- When a UI change adds a new visual pattern, document the pattern in `docs/ui-design-system.md` in the same change.
