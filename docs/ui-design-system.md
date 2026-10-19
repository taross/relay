# Relay UI design system

Relay is an operational release-control interface. Its visual language is quiet, compact, and rectilinear. State and hierarchy come from typography, spacing, and surface contrast rather than ornamental marks.

## Surfaces

- Dark mode uses softened charcoal surfaces, not pure black.
- Use `--panel`, `--soft`, `--focus`, and `--surface-hover` instead of new hard-coded neutral backgrounds.
- A separator is allowed only when it explains a real boundary: application regions, table rows, or a timeline connection.
- Do not add decorative rules, active underlines, side rails, or inset accent bars.

## Shape

- Ordinary controls use `--radius-control` (3px).
- Ordinary panels use `--radius-panel` (4px).
- Circular shapes are reserved for avatars, status dots, graph nodes, and progress indicators whose meaning requires them.
- Navigation remains rectangular. Do not turn sidebar items or tabs into floating rounded cards or pills.

## Navigation state

- Active items use stronger text weight and a low-contrast `--soft` or `--focus` surface.
- Hover uses a quieter surface than active state.
- Keyboard focus uses a visible outline; focus styling must not be reused as persistent decoration.
- Do not add arbitrary icons or geometric markers when the label already identifies the destination.

## Typography

- No visible product text may be smaller than `--font-min` (11px).
- Primary list and body content is at least 12px and regular weight.
- Object names are at least 13px and medium weight.
- Metadata uses `--font-min` and `--muted`; it must not be reduced further to make a layout fit.
- Labels name domain objects, states, or operations directly: リリース, チーム, コンポーネント, 実行計画, 検証, 承認.

## Review checklist

Before delivery, verify that:

1. New elements use existing surface and radius tokens.
2. Every line or border communicates structure.
3. Active navigation has no underline, side claw, or ornamental marker.
4. Sidebar and tabs feel native to the same rectilinear system.
5. List text remains readable without relying on hover.
6. Visible copy maps to a domain object, state, or operation.
7. Approval blockers and operational constraints are complete sentences, not noun phrases.
8. Verification procedures appear in verification or runbook views, never as approval constraints.

## Decision criteria

- Release-plan criteria use a compact definition list that names priority, objective, compatibility requirement, split-approval permission, and completion target.
- Candidate cards expose comparable metrics and operational tradeoffs. They do not use ornamental scoring badges.
- When a strategy is not generated, show the strategy name and a complete sentence explaining which planning rule excluded it.

## Verification planning

- Begin with the release-specific verification method, success criteria, execution condition, and responsible team. Verification traces are subordinate records that show what was executed.
- The responsible team explicitly defines which traces the release requires. Repository imports may attach observed runs, but must never infer or create requirements.
- Missing traces, expired traces, revision mismatch, and failed runs are distinct states and each explanation is a complete sentence naming the required action.
- Keep verification work in three adjacent views: `検証計画` owns requirements and success conditions, `テスト提案` owns selected test categories and Test Gaps, and `証跡` owns imported or manual execution records.
- Each verification view exposes only its relevant operations. Evidence import and manual result registration do not appear beside test-plan editing actions.
- Concrete test proposals lead with an executable Given / When / Then scenario, test category, execution level, affected components, and Evidence references. A category label or generic test title alone is not a test proposal.
- `ケースを採用` adds the concrete scenario to Test Selection without presenting it as already implemented or executed.

## Release decision overview

- The first release-detail view may summarize Change Intent, the frozen RC Manifest, Risk Assessment, selected tests, Release Gate, and their Evidence references.
- Summary metrics use one connected rectilinear surface. They are navigation aids and must not become decorative cards or independent scoring badges.
- Risk and Gate statements must identify the operational reason and link or name the Evidence records that support them.
- Evidence, inference, and policy outcomes remain visibly separate sections even when shown on the same overview.
- Gate blockers are complete sentences that name the responsible actor and the action or state required before reevaluation.
- The release overview reports only the selected-test count; detailed categories, cases, gaps, and acceptance actions belong to the verification views.

## Product and Feature Requirements workspace

- Product and Feature indexes use compact tables with structural row separators. Object names are links; rows must not imply click behavior outside those links.
- A Feature Requirements workspace presents Review State, Baseline Validity, and Latest Validation as three adjacent fields on one connected surface. Review State and Baseline Validity must never be combined into one status.
- Requirement sources, candidates, revisions, findings, and baselines use continuous record lists separated by structural rules rather than cards.
- Forms use token-based modal dialogs with a labelled heading, focus containment, Escape dismissal, focus restoration, and a visible keyboard-focus outline.
- Provenance copy must say whether content is Manual or a Deterministic Sample and must explicitly state when no AI model is connected.

## Dependency map

- Present dependency order as rectilinear execution-stage columns using the same panel and soft surfaces as the rest of the release workspace.
- Each component panel exposes its included changes, PR state, changed-file scope, migration, and explicit predecessor changes; do not reduce a change to a colored node label.
- Connect stages with a quiet directional marker. Avoid freeform whiteboards, rotated cards, decorative dot grids, or floating tool palettes when users cannot edit graph geometry.
