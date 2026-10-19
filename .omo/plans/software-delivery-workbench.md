# Software Delivery Workbench implementation plan

## Plan status and objective

This is an implementation plan only. It does not authorize product-code changes. It is grounded in the repository at `c1207f4` on `experiment/broader-development-support` and in:

- `docs/software-delivery-workbench-domain.md`
- `docs/software-delivery-workbench-decisions.md`
- `docs/ui-design-system.md`
- `AGENTS.md`

The objective is to replace the current whole-state prototype with a PostgreSQL-backed Software Delivery Workbench that supports multiple Products and provides complete vertical slices from Product and Feature definition through planning, change management, and release operations.

Implementation must follow the explicit task dependencies and interleaved migration gates below. A phase is complete only when its domain, append-only migration, repository, API, UI, and automated-test work is usable together. Do not create all schemas first and all screens later, and never edit a numbered migration after it has been applied.

## Current repository baseline

- `src/App.tsx` is a monolithic React component containing routing, state mutation, planning helpers, mock runbook/test execution, verification, and approval UI.
- `src/domain.ts` models most data inside mutable `Release` objects. Legacy `PlanVersion` records metadata rather than a complete immutable plan.
- `src/App.tsx` hydrates `GET /api/state`, stores domain arrays in localStorage, and debounces whole-state `PUT /api/state` writes after 450 ms.
- `server.mjs` uses a manual Node router and has no runtime request schemas, resource APIs, ETags, `If-Match`, or idempotency.
- `db/state-repository.mjs` deletes and reinserts the whole state, so concurrent clients are last-write-wins.
- `db/migrations/001_vertical_slice.sql` stores core entities as JSONB and provides only relational shells for plan versions, constraint evaluations, and change events.
- `src/planning/releaseReadModel.ts` and `src/planning/schedulingModel.ts` contain useful prototype concepts but are not deterministic authoritative planners. Unsupported constraints currently default to satisfied, capacity is approximate, compilation reads the clock, and Resource assignment uses shortcuts.
- `src/data.ts`, the local mock runner, GitHub-like fixtures, and Jev surfaces are demonstration material. They are not verified evidence, approved baselines, solver output, AI output, or production integrations.
- There are no automated tests or existing files under `.omo/plans/`.

## Target architecture

Use a modular monolith with these layers:

```text
React route/workspace modules
  → typed API client and resource DTOs
    → /api/v1 resource and command routes
      → application commands and queries
        → pure TypeScript domain modules
          → PostgreSQL repositories and normalized tables
```

PostgreSQL is the sole domain authority. Read models and impact edges are rebuildable projections. Immutable revisions, snapshots, baselines, approvals, validity events, actuals, and audit records retain exact history.

### Proposed top-level file layout

The listed paths are exact proposed paths. Existing files are changed only in the phase that cuts their responsibility over.

```text
domain/
  shared/ids.ts
  shared/result.ts
  shared/provenance.ts
  shared/revision.ts
  shared/validation.ts
  catalog/catalog.ts
  product/product.ts
  feature/feature.ts
  feature/artifacts.ts
  feature/review.ts
  specification/product-specification.ts
  delivery/delivery.ts
  delivery/deliverable.ts
  delivery/work-package.ts
  planning/policy.ts
  planning/scenario.ts
  planning/scheduling-model.ts
  planning/validators.ts
  planning/comparison.ts
  planning/solver-boundary.ts
  commitment/plan-commitment.ts
  change/change-event.ts
  change/impact.ts
  release-operations/release-candidate.ts
  release-operations/deployment.ts
  release-operations/release.ts
  release-operations/activation.ts

server/
  index.ts
  app.ts
  config.ts
  http/errors.ts
  http/etag.ts
  http/idempotency.ts
  http/request-validation.ts
  api/v1/router.ts
  db/client.ts
  db/transaction.ts
  modules/catalog/catalog-repository.ts
  modules/products/product-repository.ts
  modules/products/product-routes.ts
  modules/features/feature-repository.ts
  modules/features/feature-routes.ts
  modules/features/review-repository.ts
  modules/specifications/specification-repository.ts
  modules/specifications/specification-routes.ts
  modules/deliveries/delivery-repository.ts
  modules/deliveries/delivery-routes.ts
  modules/planning/scenario-repository.ts
  modules/planning/planning-routes.ts
  modules/commitment/commitment-repository.ts
  modules/commitment/commitment-routes.ts
  modules/change/impact-repository.ts
  modules/change/impact-routes.ts
  modules/release-operations/release-repository.ts
  modules/release-operations/release-routes.ts
  modules/audit/audit-repository.ts
  projections/impact-graph.ts
  projections/product-overview.ts
  projections/feature-workspace.ts
  projections/delivery-workspace.ts
  projections/release-workspace.ts

src/
  api/client.ts
  api/contracts.ts
  app/router.tsx
  app/query-state.ts
  components/AppShell.tsx
  components/TraceabilityLinks.tsx
  components/RevisionHeader.tsx
  components/ValidationFindings.tsx
  components/StaleWriteDialog.tsx
  routes/products/ProductListPage.tsx
  routes/products/ProductOverviewPage.tsx
  routes/features/FeatureWorkspacePage.tsx
  routes/features/ArtifactReviewPanel.tsx
  routes/deliveries/DeliverySchedulePage.tsx
  routes/deliveries/TrainPage.tsx
  routes/deliveries/ConstraintPage.tsx
  routes/deliveries/ScenarioComparisonPage.tsx
  routes/impacts/ImpactPage.tsx
  routes/releases/ReleaseWorkspacePage.tsx

db/migrations/
  002_platform_foundation.sql
  003_products_catalog.sql
  004_features_reviews.sql
  005_product_specifications.sql
  006_deliveries_deliverables.sql
  007_verification_provenance.sql
  008_planning_core.sql
  009_planning_validation.sql
  010_commitment_baselines.sql
  011_change_impact.sql
  012_release_candidates.sql
  013_deployments.sql
  014_releases_activations.sql
  015_legacy_retirement.sql
db/seeds/software-delivery-workbench.sql

scripts/
  migrate-legacy-state.ts
  verify-legacy-migration.ts
  seed-software-delivery-workbench.ts

test/
  helpers/database.ts
  helpers/http-server.ts
  fixtures/builders.ts
  unit/**/*.test.ts
  repository/**/*.test.ts
  http/**/*.test.ts

e2e/
  software-delivery-workbench.spec.ts
  concurrency.spec.ts
  accessibility.spec.ts

vitest.config.ts
playwright.config.ts
tsconfig.server.json
```

`package.json` will add the server TypeScript runner/build, runtime schema validation, Vitest, and Playwright scripts and dependencies when Phase 1 begins. Prefer one runtime validation library rather than handwritten endpoint-specific parsers. `server.mjs` remains the temporary entry point until `server/index.ts` reaches health-check and `/api/v1/products` parity.

## Cross-cutting implementation rules

1. Every write names one Product and rejects cross-Product references.
2. Every immutable subject is addressed by revision id, not “latest,” in decisions and baselines.
3. The server supplies time, sequence, ETag, canonical SHA-256, and audit identity. Pure computation receives time as an explicit input.
4. Mutable resources use `If-Match`; commands use `Idempotency-Key`.
5. Validation is tri-state: `satisfied`, `violated`, or `unknown`. Unsupported mandatory checks block.
6. Warning overrides require an explicit human rationale recorded against exact findings.
7. The UI must not optimistically show approvals, commitments, deployments, releases, or activations as complete before the server acknowledges them.
8. Implement route-specific reads; never replace `/api/state` with another all-domain payload.
9. Use stable sort keys and canonical units. Scenario comparison output discloses formulas, units, source revisions, and unknown handling.
10. Preserve the compact rectilinear design system. Reuse tokens from `src/style.css`; do not add prohibited active rails, decorative dots, active underlines, oversized pills, rounded navigation cards, or text below `--font-min`.
11. Use semantic headings, landmarks, tables, lists, buttons, form labels, live error summaries, visible focus, and complete-sentence blockers/constraints. Keep verification procedures out of constraint lists.
12. A phase adds or updates `docs/ui-design-system.md` only if it introduces a genuinely new visual pattern.

## Information architecture and navigation contract

Implement these routes incrementally as their backing slice becomes available:

| Workspace | Route | Primary purpose |
| --- | --- | --- |
| Product list | `/products` | Select among multiple Products and create a Product |
| Product Overview | `/products/:productId` | Current/Target Product Specification, Features, Deliveries, Trains, active baselines, and release status |
| Feature Workspace | `/products/:productId/features/:featureId` | Five artifact phases, revisions, reviews, Deliverable links, and traceability |
| Delivery Schedule | `/products/:productId/deliveries/:deliveryId/schedule` | Activities, Work Packages, Resources, actuals, and selected Scenario revision |
| Train view | `/products/:productId/deliveries/:deliveryId/trains/:trainId` | Cutoff, assigned Deliverables, readiness, and capacity |
| Constraint view | `/products/:productId/deliveries/:deliveryId/constraints` | Mandatory/configurable/advisory rules and tri-state findings |
| Comparison view | `/products/:productId/deliveries/:deliveryId/scenarios/compare?left=:leftRevisionId&right=:rightRevisionId` | Formula-disclosed comparison of exact Scenario revisions |
| Impact view | `/products/:productId/changes/:changeSetId/impact` | Direct/Transitive/Potential/Unaffected paths, recommendations, and validity decisions |
| Release Workspace | `/products/:productId/release-candidates/:releaseCandidateId` | Candidate composition, Deployments, Release, Activations, and traceability |

`src/components/TraceabilityLinks.tsx` provides bidirectional navigation. Each subject view links forward to downstream consumers and back to upstream source revisions. Links include Product context and meaningful accessible names, for example “Open Plan Baseline PB-3 used by this Release Candidate,” not generic “View.” Browser history and direct URLs must restore the same selected revision.

---

## Migration and legacy retirement

Migration is incremental by vertical slice, one-way, and observable. M1–M4 are interleaved execution gates, not a standalone predecessor phase. There is no indefinite dual-write period.

| Order | Gate | Dependency and result |
| --- | --- | --- |
| 1 | P1.1 bootstrap | Add only package scripts, Vitest helpers, and a test server harness so the legacy path can be characterized before behavior changes. |
| 2 | M1 | Run characterization, backup, and temporary whole-state ETag protection before applying native schema migrations. |
| 3 | P1.1 platform | Apply `002_platform_foundation.sql` and complete runtime validation, transactions, audit, ETag, and durable command receipts. |
| 4 | P1.2 then M2 product/catalog stage | Apply `003_products_catalog.sql`, ship the Product slice, then import/reconcile only Product/catalog mappings. |
| 5 | P1.3/P1.4 then M2 feature stage | Apply `004_features_reviews.sql` and `005_product_specifications.sql`, ship both slices, then import/reconcile eligible Feature data. |
| 6 | P2 then M2 delivery stage | Apply `006_deliveries_deliverables.sql` and `007_verification_provenance.sql`, ship Phase 2, then import/reconcile Deliveries and explicitly synthetic/unverified evidence. |
| 7 | P3 then M2 planning stage | Apply `008_planning_core.sql` and `009_planning_validation.sql`, ship Phase 3, then import legacy PlanVersion only as unverified Scenario metadata/snapshots. |
| 8 | P4 then M2 change stage | Apply `010_commitment_baselines.sql` and `011_change_impact.sql`, ship Phase 4, then import eligible Change Events; legacy mutable approvals remain unverified candidates. |
| 9 | P5 | Apply `012_release_candidates.sql`, `013_deployments.sql`, and `014_releases_activations.sql` with their corresponding vertical slices. |
| 10 | M3/M4 | Cut each route after its phase gate; after final reconciliation and Phase 5 acceptance, apply `015_legacy_retirement.sql`, then run seeded demo and full verification. |

### M1 — Inventory and freeze semantics

**Dependency:** the P1.1 bootstrap test harness, but no native schema or behavior change.

1. Add characterization tests around current `GET/PUT /api/state`, `readState()`, `writeState()`, and legacy fixture loading before changing them.
2. Export a checksum-bearing backup of current `teams`, `components`, `releases`, `plan_versions`, `constraint_evaluations`, and `change_events`.
3. Add and test temporary ETag protection on `/api/state` to prevent additional silent loss during migration.
4. Document that current `PlanVersion`, approval fields, graph hashes, mock runner results, GitHub fixtures, and Jev evaluations are non-authoritative.

### M2 — One-way normalized import

**Dependency:** each `--stage` runs only after the named native migration and vertical slice pass their repository/HTTP acceptance tests.

Implement `scripts/migrate-legacy-state.ts` as a restartable, transactional staged import with `--stage product-catalog|features|deliveries|planning|change`:

- map only records whose target tables exist for that stage;
- record source table/id, source checksum, importer version, stage, imported time, and target ids;
- classify imported assertions as `legacy-imported-unverified` unless independently recreated and approved through native flows;
- import legacy `PlanVersion` as migration metadata or unverified Scenario snapshot only, never Plan Baseline;
- import mutable approvals as unverified decision candidates, never append-only approval history;
- import fixture/mock evidence as `synthetic-demo` or omit it according to an explicit report;
- produce per-stage counts, rejected rows, unknown references, and checksum comparisons.

Implement `scripts/verify-legacy-migration.ts --stage <stage>` to reconcile source rows to stage mapping/report rows and verify Product scope and reference integrity. A completed stage is read-only thereafter. Do not dual-write native and legacy models.

### M3 — Route-by-route cutover

1. Cut Product/Feature routes to `/api/v1` after Phase 1 acceptance passes.
2. Cut Deliverable/QA routes after Phase 2.
3. Cut planning routes after Phase 3; remove calls to client `graphRevision`, legacy approval eligibility, and Release-coupled planning helpers.
4. Cut commitment/impact after Phase 4.
5. Cut Release Workspace after Phase 5.
6. During each window, compatibility `GET /api/state` may be a read-only projection from normalized resources for uncut legacy screens. Never write normalized changes back to legacy JSON and never read legacy data as newer authority.

### M4 — Retirement

After all routes and tests use `/api/v1`:

- add `db/migrations/015_legacy_retirement.sql` to archive or drop legacy tables only after backup/reconciliation sign-off;
- make `PUT /api/state` return `410 Gone` with migration guidance, then remove the route in a later cleanup;
- remove domain localStorage keys and `useStored` domain persistence from `src/App.tsx`;
- remove `db/state-repository.mjs` and superseded responsibilities in `db/evaluation-repository.mjs`;
- remove or archive `src/planning/releaseReadModel.ts` and `src/planning/schedulingModel.ts` after pure replacements pass parity tests;
- remove client `graphRevision`, mutable approval/invalidation logic, local mock runner, and misleading GitHub/Jev action surfaces;
- reduce `src/domain.ts` to temporary compatibility exports, then remove it after all imports use the new domain/contracts;
- replace `server.mjs` with the built `server/index.ts` entry after startup, health, shutdown, and production build checks pass;
- update `docs/ui-design-system.md` only for any new patterns actually introduced.

### Migration acceptance tests

- Migration is restartable and produces the same mappings/counts after interruption.
- Every imported target row has source lineage and checksum.
- Unmappable/cross-Product references are reported and not silently repaired.
- No legacy approval or PlanVersion appears as an approved native baseline.
- Compatibility GET and native resources agree for the bounded fields during each cutover.
- After retirement, no application code calls `PUT /api/state`, reads authoritative domain localStorage, or imports removed mock runner/Jev/GitHub fixture actions.

### Migration negative paths

- Import aborts its transaction on checksum mismatch or duplicate conflicting identity.
- Import never upgrades unknown/unverified provenance based on field names such as `approved` or `passed`.
- A failed native write is not retried through the legacy endpoint.
- `PUT /api/state` cannot remain as a hidden fallback after its slice is cut over.
- Legacy table removal cannot run before backup, reconciliation report, target acceptance tests, and explicit operator confirmation.

---

## Phase 1 — Product / Feature

**Goal:** establish safe platform foundations and deliver complete Product, Feature, artifact-review, and Product-specification vertical slices.

### P1.1 — Add test, server, validation, and concurrency foundations

**Dependencies:** none. Execute this task internally as bootstrap test harness → M1 characterization/backup/temporary ETag gate → platform migration/runtime foundations.

**Files:**

- add `tsconfig.server.json`, `vitest.config.ts`, `playwright.config.ts`
- update `package.json` and lockfile with explicit scripts: `build`, `test:unit`, `test:repository`, `test:http`, `test:e2e`, `test`, and database migration/seed commands
- add `server/config.ts`, `server/db/client.ts`, `server/db/transaction.ts`
- add `server/http/errors.ts`, `server/http/request-validation.ts`, `server/http/etag.ts`, `server/http/idempotency.ts`
- add `test/helpers/database.ts`, `test/helpers/http-server.ts`, `test/fixtures/builders.ts`
- add `db/migrations/002_platform_foundation.sql`

**Implementation:**

- Create migration bookkeeping, durable `command_receipts`, and append-only `audit_events`.
- Retain each irreversible command key, canonical request hash, Product/actor scope, and outcome reference for at least as long as the outcome; archival must preserve uniqueness and replay. Back this with domain uniqueness constraints for terminal decisions, accepted commitment baselines, and operational transition events.
- Add a schema-validation boundary for parameters, query values, bodies, and persisted JSONB documents.
- Standardize error envelopes with stable code, complete message, field/finding details, request id, and current-resource link where applicable.
- Add transaction helpers that require the domain write and audit event to commit together.
- Keep `server.mjs` serving the current app while `server/index.ts` and `server/app.ts` are introduced behind the same health contract.
- As a temporary safety bridge only, return an ETag from `GET /api/state` and require `If-Match` on `PUT /api/state`. This bridge must not become the target design.

### P1.2 — Product and catalog vertical slice

**Dependencies:** P1.1.

**Files:**

- add `domain/shared/{ids,result,provenance,revision,validation}.ts`
- add `domain/catalog/catalog.ts`, `domain/product/product.ts`
- add `db/migrations/003_products_catalog.sql` with Product/catalog tables
- add `server/modules/catalog/catalog-repository.ts`
- add `server/modules/products/{product-repository,product-routes}.ts`
- add `server/projections/product-overview.ts`
- add `server/api/v1/router.ts`, `server/app.ts`, `server/index.ts`
- add `src/api/{client,contracts}.ts`, `src/app/{router,query-state}.ts`
- add `src/routes/products/{ProductListPage,ProductOverviewPage}.tsx`
- add `src/components/{AppShell,TraceabilityLinks,StaleWriteDialog}.tsx`
- narrow `src/App.tsx` to composition/routing only; retain legacy routes until their later cutovers

**Implementation:**

- Persist multiple Products, Teams, Resources, Target Systems, Environments, and catalog versions.
- Implement `GET/POST /api/v1/products`, `GET/PATCH /api/v1/products/:productId`, and focused catalog endpoints.
- Return ETags for mutable Product/catalog resources and require `If-Match` on updates.
- Build Product list and initial Product Overview from server resources; localStorage may retain presentation preferences only.
- Ensure direct navigation and reload hydrate from PostgreSQL.

### P1.3 — Feature and five artifact-phase vertical slice

**Dependencies:** P1.2.

**Files:**

- add `domain/feature/{feature,artifacts,review}.ts`
- add append-only `db/migrations/004_features_reviews.sql` with `features`, `feature_artifact_streams`, immutable `feature_artifact_revisions`, `review_requests`, `review_events`, `feature_gate_snapshots`, and `feature_approval_events`
- add `server/modules/features/{feature-repository,feature-routes,review-repository}.ts`
- add `server/projections/feature-workspace.ts`
- add `src/routes/features/{FeatureWorkspacePage,ArtifactReviewPanel}.tsx`
- add `src/components/RevisionHeader.tsx`

**Implementation:**

- Create the five streams: Requirements, Specification, Solution Design, Verification Planning, and Delivery Readiness.
- Append immutable revisions and review events. Derive Not Started, Draft, In Review, Changes Requested, Approved, and Superseded from history.
- Require idempotency on revision creation and review decisions.
- Make the reviewed revision explicit in every request/decision.
- Present Delivery Readiness as a feature artifact/gate only; use unambiguous copy stating that it does not approve the Delivery Plan.

### P1.4 — Current, Approved Feature, and Target Product Specifications

**Dependencies:** P1.3.

**Files:**

- add `domain/specification/product-specification.ts`
- add append-only `db/migrations/005_product_specifications.sql` with `product_specification_revisions`, `product_specification_inputs`, `product_specification_conflicts`, `product_specification_baselines`, Current Designation Events, and validity events
- add `server/modules/specifications/{specification-repository,specification-routes}.ts`
- extend `server/projections/product-overview.ts`
- extend `src/routes/products/ProductOverviewPage.tsx`
- add unit tests under `test/unit/product-specification.test.ts`

**Implementation:**

- Model Current Product Specification, Approved Feature Specification, and Target Product Specification explicitly.
- Select Current only at an explicit `asOf` through append-only Current Designation Events naming exact approved baseline ids/hashes. Events with `effective_at <= asOf` are eligible; maximum `(effective_at, server-assigned Product-monotonic sequence)` wins. This excludes future-effective events and deterministically resolves backdated and equal-effective-time designations; “latest approved” and append order alone are never selection rules.
- Assemble a Target from that exact designated Current baseline plus an explicit ordered input set; persist `asOf`, designation event id, and Current baseline id/hash in the Target input set, and validate conflicts by stable claim address independent of input order. Later Current designations cannot alter an existing Target.
- Emit deterministic `compatible`, `conflict`, or `unknown` results naming source revisions, claim address, validator version, and compared values.
- Require humans to revise, defer, or record a revisioned scoped resolution. Never pick a winner based on list order.
- Make Product baseline approval an immutable, append-only decision separate from Feature approval.

### Phase 1 acceptance tests

Automate these in `test/unit`, `test/repository`, `test/http`, and `e2e/software-delivery-workbench.spec.ts`:

1. Create two Products and Features under each; list/reload returns both without cross-contamination.
2. Create each of the five artifact revisions, request review, request changes, create a successor, and approve the exact successor; history remains visible.
3. Attempt to edit an approved artifact; the API rejects mutation and accepts creation of a successor revision.
4. Designate an exact approved Product Specification baseline as Current, build a Target from it plus approved Feature Specifications, and prove that later approval/designation events do not change the persisted `asOf`, event id, or baseline inputs.
5. At fixed `asOf` values, prove that future-effective events are excluded, a later-recorded backdated event does not displace a later-effective event, and equal `effective_at` values resolve by Product-monotonic sequence.
6. Repeated Target builds with differently ordered equivalent input requests produce the same canonical findings/hash.
7. Two explicit incompatible claims produce a conflict identifying both source revisions; no baseline is created.
8. Product Overview and Feature Workspace reload from PostgreSQL with no domain localStorage dependency.
9. Open two browser contexts, update a mutable Product in context A, then submit context B's stale ETag; B receives `412` and the UI shows a reload/reapply path.
10. Repeat a revision or approval command with the same idempotency key and payload before and after server restart/receipt archival; only one event exists and the original response is returned.
11. Keyboard users can reach navigation, artifact tabs, revision controls, error summary, and traceability links with visible focus.

### Phase 1 negative paths

- Missing `If-Match` returns `428`; stale `If-Match` returns `412`; neither changes data.
- Reusing an idempotency key with a different payload is rejected, including after process restart or command-receipt archival; pruning cannot permit a second irreversible outcome.
- Feature creation with another Product's owner/catalog reference is rejected.
- Review approval against a superseded or different revision is rejected.
- Changes Requested never mutates the reviewed revision back to Draft.
- Delivery Readiness approval does not create a Plan commitment, Plan Baseline, or plan approval event.
- Unapproved Feature Specifications cannot enter an approved Target Product Specification.
- Target assembly without explicit `asOf`, with no eligible Current Designation Event, or with a designation that names a non-approved/cross-Product/hash-mismatched baseline is rejected; a future event cannot be selected early.
- Missing or unsupported mandatory claims return `unknown` and block Product baseline approval.
- Malformed request bodies and unrecognized enum values fail runtime validation with no partial writes.

---

## Phase 2 — Design / QA / Deliverable

**Goal:** connect approved Feature intent to revisioned Solution Design, Verification Planning, Delivery Readiness, and concrete multi-system Deliverables.

### P2.1 — Deliverable and Work Package vertical slice

**Dependencies:** Phase 1.

**Files:**

- add `domain/delivery/{delivery,deliverable,work-package}.ts`
- add `db/migrations/006_deliveries_deliverables.sql`
- add `server/modules/deliveries/{delivery-repository,delivery-routes}.ts`
- add `server/projections/delivery-workspace.ts`
- extend `src/routes/features/FeatureWorkspacePage.tsx`
- add the first read-only shell of `src/routes/deliveries/DeliverySchedulePage.tsx`, backed by real resources
- add `test/unit/deliverable.test.ts`, `test/repository/deliverable-repository.test.ts`, and `test/http/deliverables.test.ts`

**Implementation:**

- Add Product-scoped Deliveries and immutable Deliverable revisions.
- Store Target System, Environment, Work Packages, explicit predecessor/order relationships, readiness, artifact revision, dependencies, owner, and optional Train assignment as normalized relations.
- Add explicit `feature_deliverables` many-to-many links; do not embed Deliverables under one Feature.
- Link Solution Design and Verification Planning revisions to exact Feature and Deliverable revisions.
- Record Delivery Readiness findings without converting them to Plan approval.

### P2.2 — Verification semantics and evidence provenance

**Dependencies:** P2.1.

**Files:**

- extend `domain/feature/artifacts.ts`, `domain/shared/provenance.ts`, and `domain/shared/validation.ts`
- add append-only `db/migrations/007_verification_provenance.sql` with verification criteria, evidence assertions, and provenance/assurance fields
- extend `server/modules/features/feature-routes.ts` and `server/modules/deliveries/delivery-routes.ts`
- extend `src/routes/features/FeatureWorkspacePage.tsx`
- add `src/routes/features/verification/{VerificationPlanView,TestProposalView,EvidenceView}.tsx`
- add `src/components/ValidationFindings.tsx`
- replace or remove mock execution sections from `src/App.tsx` only after equivalent native routes are live

**Implementation:**

- Render adjacent Feature Workspace views labeled `検証計画`, `テスト提案`, and `証跡`; preserve route/query selection so each view hydrates independently and the three operations cannot be mistaken for one another.
- Keep authored verification plans, Given/When/Then test proposals, execution observations, and evidence assertions as separate resources. `ケースを採用` copies a proposal into a new Verification Planning revision; it never marks the case implemented, executed, passed, or evidenced.
- Keep evidence import and manual evidence registration in `証跡`, not inside the Verification Plan editor. An evidence record always names its exact subject revision and provenance.
- Label manual, system-observed, deterministic-derived, legacy-imported-unverified, and synthetic-demo provenance.
- Reframe current fixture GitHub runs, README imports, and local mock runner results as synthetic/unverified demo records or remove their UI entry points.
- Never infer verification from a URL, expected text, or fixture success. Mandatory evidence accepts only the assurance defined by the applicable rule.

### P2.3 — Traceability and readiness workspace

**Dependencies:** P2.2.

**Files:**

- extend `server/projections/feature-workspace.ts` and `server/projections/delivery-workspace.ts`
- extend `src/components/TraceabilityLinks.tsx`
- extend `src/routes/features/FeatureWorkspacePage.tsx`
- extend `src/routes/deliveries/DeliverySchedulePage.tsx`
- add E2E coverage to `e2e/software-delivery-workbench.spec.ts`

**Implementation:**

- Provide bidirectional Feature ↔ Artifact Revision ↔ Deliverable Revision ↔ Work Package links.
- Show readiness blockers as complete sentences naming actor/required state/timing or threshold.
- Place verification procedures in Verification Planning, not in constraint or blocker lists.
- Preserve compact tables and restrained surfaces; use structural separators only.

### Phase 2 acceptance tests

1. Link Feature A and Feature B to a shared backend Deliverable while linking each to applicable mobile Deliverables; both directions return the same relations.
2. Create a successor Deliverable revision without mutating the approved predecessor.
3. Persist backend, iOS, and Android Target Systems and Environments with explicit Work Packages and dependencies.
4. Traverse from an Approved Feature Specification to its Deliverables and back through accessible links.
5. Record manual evidence and display its provenance and assurance without calling it verified.
6. Record a system-observed evidence item against an exact artifact revision and use it only when the mandatory evidence rule permits that assurance.
7. Approve Delivery Readiness and confirm no Delivery Plan commitment is created.
8. Reload Feature and Delivery workspaces and preserve selected exact revisions in the URL/read model.
9. Move among adjacent `検証計画`, `テスト提案`, and `証跡` views with keyboard and direct URLs; each retains its own operation and subject revision.
10. Create a Given/When/Then proposal, select `ケースを採用`, and confirm a new Verification Planning revision contains the copied case while proposal and evidence histories remain separate and no executed/passed state is shown.
11. Register/import evidence only from `証跡`; confirm it cannot silently edit Verification Planning or claim an execution result.

### Phase 2 negative paths

- A Feature cannot link to a Deliverable from another Product.
- A Deliverable cannot reference an unknown Target System, Environment, Work Package, artifact revision, or predecessor.
- A Deliverable dependency cycle is rejected with the cycle path.
- Display order cannot satisfy an explicit predecessor/order rule.
- Synthetic demo output and legacy GitHub fixtures cannot satisfy mandatory verified evidence.
- A proposal cannot be rendered as implemented/executed/passed merely because `ケースを採用` copied it into a Verification Planning revision.
- Evidence registration/import from the plan editor is rejected; evidence cannot attach without an exact subject revision and truthful provenance.
- An unknown evidence state is not rendered as passed or verified.
- Editing an approved Deliverable/artifact revision is rejected; deletion cannot erase referenced history.
- A blocker written as a verification procedure fails content validation/review and is not saved as a constraint.

---

## Phase 3 — Delivery Planning

**Goal:** support truthful manual planning, deterministic validation, clone isolation, disclosed comparison, Trains, Resources, Constraints, actuals, and a future solver boundary without claiming a solver exists.

### P3.1 — Planning Policy, Resources, Trains, and Scenario revisions

**Dependencies:** Phase 2.

**Files:**

- add `domain/planning/{policy,scenario}.ts`
- add `db/migrations/008_planning_core.sql`
- add `server/modules/planning/{scenario-repository,planning-routes}.ts`
- add `src/routes/deliveries/{TrainPage,ConstraintPage}.tsx`
- extend `src/routes/deliveries/DeliverySchedulePage.tsx`
- add repository and HTTP tests under `test/repository/planning-repository.test.ts` and `test/http/planning.test.ts`

**Implementation:**

- Normalize Planning Policies, mandatory/configurable/advisory constraints, immutable mandatory rule versions, Resources and dated integer capacity, Activities, predecessors, demands, Trains/cutoffs, Deliverable order, actuals, Scenarios, and immutable Scenario Revisions.
- Require each Scenario to scope exactly one Product and one Delivery.
- Create manual Scenarios with `manual` provenance. Creating a revision or running validation must not relabel provenance.
- Clone into a new Scenario identity and copy immutable values; do not share mutable child rows.
- Append actuals and corrective observations rather than rewriting prior observations.

### P3.2 — Pure compilation and deterministic validators

**Dependencies:** P3.1.

**Files:**

- add `domain/planning/scheduling-model.ts`, `domain/planning/validators.ts`
- extract and then retire target responsibilities from `src/planning/schedulingModel.ts` and `src/planning/releaseReadModel.ts`
- add append-only `db/migrations/009_planning_validation.sql` for validation runs/findings and canonical input hashes
- add `test/unit/scheduling-model.test.ts` and `test/unit/scenario-validators.test.ts`
- extend `server/modules/planning/planning-routes.ts`
- extend `src/routes/deliveries/{DeliverySchedulePage,ConstraintPage,TrainPage}.tsx`

**Implementation:**

- Implement pure `compileSchedulingModel(revision, catalog)` with stable ordering and no clock/network/random/locale reads.
- Implement `validateScenario(model, { asOf, validatorSetVersion })` with exact input SHA and persisted run/findings.
- Add validators for Product scope, reference integrity, dependency cycles, predecessor completion/timing, sweep-line Resource capacity, Train cutoff, explicit Deliverable order, mandatory coverage/alteration, baseline mutation, and unknown versus verified assurance.
- Remove the current default-satisfied fallback. Unsupported kinds produce `unknown`.
- Do not assign all verification work to the first Resource; require explicit demand or return unknown.

### P3.3 — Deterministic candidates and disclosed comparison

**Dependencies:** P3.2.

**Files:**

- add `domain/planning/comparison.ts`, `domain/planning/solver-boundary.ts`
- add `src/routes/deliveries/ScenarioComparisonPage.tsx`
- add `test/unit/scenario-comparison.test.ts`
- extend `server/modules/planning/planning-routes.ts`

**Implementation:**

- Extract useful candidate heuristics from `derivePlanCandidates` only after removing Release-specific coupling and implicit time. Label outputs `deterministic-derived`, not solver output.
- Implement the initial metric contract exactly: completion instant; Product-calendar elapsed working minutes and displayed working days; exact rational peak constrained-Resource utilization; signed elapsed-minute Train cutoff margins keyed by Train plus an overall minimum; separate violated and unknown counts for mandatory and advisory findings; and explicit deferred-Deliverable count. Per Train, calculate `cutoff_at - max(ready_at)` across required Deliverables assigned to that Train. If any required Deliverable lacks assignment/readiness or an assigned Train lacks cutoff, mark its entry and the overall value `unknown` while disclosing known Train margins. Store UTC instants, display in Product IANA timezone, use half-open `[start,end)` intervals with end-before-start sweep ties, integer minutes, stable finding ids, declared rounding, and reasons for every unknown.
- Persist metric-definition version, Product calendar/policy versions, exact Scenario revision ids, canonical input hashes, exact values, and display values. Never substitute wall-clock, locale-global, “latest,” or missing-as-zero data.
- Define a future `SolverRunAdapter` contract with engine/version, parameters, canonical input/output hashes, logs, and `solver-run` provenance. Provide no implementation and no UI claim that a solver ran.
- Comparison reads exact Scenario revisions and cannot silently move to “latest.”

### Phase 3 acceptance tests

1. Create a manual Scenario and multiple revisions; all retain manual provenance and immutable predecessors.
2. Clone a Scenario, edit the clone, and prove the source revision and relationships are unchanged.
3. Compile identical canonical input twice with the same explicit context and obtain identical content/hash.
4. Detect a dependency cycle and disclose its path.
5. Detect predecessor timing where a successor begins before required completion.
6. Detect overlapping shared-Resource demand with a sweep-line calculation and integer capacity.
7. Detect a Train cutoff miss and explicit backend-before-mobile order violation.
8. Reject weakened/removal attempts for mandatory rules; allow a new policy version through the explicit policy-revision flow.
9. Return `unknown` for unsupported rules or missing capacity/evidence and block when mandatory.
10. Compare exact manual and deterministic-derived Scenario revisions and display every formula, unit, input id, policy/calendar version, exact value, rounded display value, and unknown reason.
11. Unit-test boundary rules: touching half-open windows do not overlap, ending demand is removed before starting demand, integer-minute working calendars handle weekends, rational utilization compares without float ordering, per-Train margins aggregate by minimum, and a missing required assignment/readiness/cutoff makes the overall cutoff metric `unknown` without hiding known Train margins.
12. Persist an Actual, reload, and include it in the next explicit validation context without changing the prior Validation Run.
13. All planning views are keyboard navigable and retain readable labels at compact widths.

### Phase 3 negative paths

- A Scenario referencing two Products or another Product's Resource/Deliverable/Train is rejected.
- A Scenario revision cannot mutate or delete a committed/otherwise immutable predecessor.
- Clone operations cannot share mutable Activity, demand, assignment, or constraint rows.
- Missing capacity is `unknown`, not zero demand or unlimited capacity.
- Unsupported constraints cannot default to satisfied.
- A mandatory violation or unknown cannot be bypassed by changing a client field.
- Advisory warning override without rationale is rejected.
- Comparison cannot combine revisions from different Products or omit metric definitions.
- Deterministic heuristics, Jev, and fixture outputs are never labeled solver or AI results.
- Reusing the same future solver-run boundary for a manual result is prohibited by provenance validation.

---

## Phase 4 — Commitment / Change Management

**Goal:** commit exact valid plans through human decisions, preserve immutable baselines, evaluate graph-based change impact, and replan without auto-revocation.

### P4.1 — Commitment request, approval, and immutable Plan Baseline

**Dependencies:** Phase 3.

**Files:**

- add `domain/commitment/plan-commitment.ts`
- add `db/migrations/010_commitment_baselines.sql` with commitment/baseline and Baseline Replacement Event tables
- add `server/modules/commitment/{commitment-repository,commitment-routes}.ts`
- extend `src/routes/deliveries/{DeliverySchedulePage,ConstraintPage}.tsx`
- add `test/unit/plan-commitment.test.ts`, `test/repository/commitment-repository.test.ts`, and `test/http/commitment.test.ts`

**Implementation:**

- Create a commitment request for one exact Scenario Revision and current Validation Run.
- Recheck commit preconditions transactionally: required artifact approvals, current validator/input hashes, all mandatory satisfied, advisory exceptions with rationale, and Product scope.
- Append approval/decision and create the immutable Plan Baseline and audit event in one transaction.
- Keep Scenario Revision, Validation Run, approval event, Plan Baseline, and Plan Commitment as distinct records.
- Treat legacy `PlanVersion` as unverified migration metadata only.

### P4.2 — Change Events and graph-based impact

**Dependencies:** P4.1.

**Files:**

- add `domain/change/{change-event,impact}.ts`
- add append-only `db/migrations/011_change_impact.sql` with change sets/events, impact projections, assessments, recommendations, decisions, and baseline validity events
- add `server/modules/change/{impact-repository,impact-routes}.ts`
- add `server/projections/impact-graph.ts`
- add `src/routes/impacts/ImpactPage.tsx`
- add `test/unit/impact.test.ts`, `test/repository/impact-repository.test.ts`, and `test/http/impact.test.ts`

**Implementation:**

- Append Product-scoped Change Events with exact changed subject/revision, provenance, actor, reason, and old/new facts where known.
- Rebuild `impact_edges` from normalized Feature/artifact/Deliverable/dependency/Scenario/baseline relationships.
- Traverse and classify Direct, Transitive, Potential, or Unaffected impacts. Store reason paths, graph version, input revisions, validator version, and `asOf`.
- Return Potential rather than Unaffected when facts or graph coverage are incomplete.
- Present accept/defer/reject recommendations. Record the human response; do not auto-revoke an approval or mutate a baseline.
- Append baseline validity events to derive Current, Impacted, Invalid, or Not Evaluated independently from review state.

### P4.3 — Delay, replan, and replacement baseline flow

**Dependencies:** P4.2.

**Files:**

- extend `domain/planning/scenario.ts`, `domain/change/impact.ts`, and `domain/commitment/plan-commitment.ts`
- extend `server/modules/{planning,change,commitment}` routes/repositories
- extend `src/routes/impacts/ImpactPage.tsx` and `src/routes/deliveries/DeliverySchedulePage.tsx`
- extend `e2e/software-delivery-workbench.spec.ts`

**Implementation:**

- Record delay as an Actual and Change Event.
- Assess the committed Plan Baseline and append Impacted/Not Evaluated/Invalid validity as rules and human decisions require.
- On accepted replanning, clone the committed Scenario into a new identity/revision, preserving source linkage.
- Re-run validation and human commitment to create a new Plan Baseline.
- After the new baseline commits, append a Baseline Replacement Event linking the old and new exact ids/hashes. Replacement is not a fifth validity state; the old baseline retains its final Current/Impacted/Invalid/Not Evaluated validity. Never rewrite the old baseline, its approval, or its validation.

### Phase 4 acceptance tests

1. Commit one exact Scenario Revision only after its current Validation Run has all mandatory findings satisfied.
2. Query review approval history, Plan commitment history, and baseline validity history independently.
3. Attempt to update/delete the Plan Baseline and prove repository/database rejection while canonical SHA remains unchanged.
4. Record a direct Deliverable delay and obtain Direct impact on that Deliverable, Transitive impact on dependent mobile work/baseline, and disclosed reason paths.
5. Remove required graph knowledge in a fixture and obtain Potential, not Unaffected.
6. Accept, defer, and reject recommendations in separate tests; each appends a human decision and none auto-revokes approval.
7. Complete delay → Impacted baseline → accepted replan → cloned Scenario → validated revision → new committed baseline → Baseline Replacement Event linking old to new while old retains its final four-state validity.
8. Reload Impact and Delivery views and reconstruct the full event, replacement, and validity timelines from PostgreSQL.
9. Retry commitment and impact-decision commands with identical idempotency keys before and after server restart/receipt archival without duplicate events or baselines.

### Phase 4 negative paths

- Feature Artifact approval or Delivery Readiness cannot create a Plan Commitment.
- Stale Validation Runs, mismatched input hashes, mandatory `violated`, or mandatory `unknown` findings block commitment.
- Advisory warnings without a recorded rationale block the proceed command.
- A client cannot provide its own authoritative baseline hash, approval actor time, or validity status.
- Change Events cannot reference another Product's subjects.
- Missing impact facts cannot produce Unaffected.
- An impact recommendation cannot mutate or delete prior approval events.
- A committed Scenario/Plan Baseline cannot be edited during replanning.
- A Baseline Replacement Event cannot exist before the new commitment transaction succeeds, cannot cross Products, and cannot mutate or invent a fifth validity state for the prior baseline.

---

## Phase 5 — Release Operations

**Goal:** provide separate, auditable Release Candidate, Deployment, Release, and Activation records and transitions.

### P5.1 — Release Candidate composition and readiness

**Dependencies:** Phase 4.

**Files:**

- add `domain/release-operations/release-candidate.ts`
- add `db/migrations/012_release_candidates.sql`
- add `server/modules/release-operations/{release-repository,release-routes}.ts`
- add `server/projections/release-workspace.ts`
- add `src/routes/releases/ReleaseWorkspacePage.tsx`
- add unit/repository/HTTP tests under `test/{unit,repository,http}/release-candidate*.test.ts`

**Implementation:**

- Assemble an immutable Release Candidate from exact Product Specification baseline, Plan Baseline, Deliverable artifact revisions, and readiness/evidence references.
- Validate Product scope, immutable hashes, required Deliverables, readiness, and evidence assurance.
- Record accepted/rejected candidate decisions as append-only events; rejection does not mutate composition.

### P5.2 — Deployment transitions

**Dependencies:** P5.1.

**Files:**

- add `domain/release-operations/deployment.ts`
- add append-only `db/migrations/013_deployments.sql`
- extend release repository/routes and `ReleaseWorkspacePage.tsx`
- add `test/unit/deployment.test.ts` and matching repository/HTTP tests

**Implementation:**

- Create one Deployment per Release Candidate/environment attempt with planned, in-progress, succeeded, failed, and rolled-back transitions.
- Record observations and actuals with provenance and idempotent commands.
- Do not claim external deployment automation; transitions are explicit human/system-observed records within the workbench.

### P5.3 — Release and Activation transitions

**Dependencies:** P5.2.

**Files:**

- add `domain/release-operations/{release,activation}.ts`
- add append-only `db/migrations/014_releases_activations.sql`
- extend release repository/routes, projection, and `ReleaseWorkspacePage.tsx`
- add `test/unit/{release,activation}.test.ts` and matching repository/HTTP tests
- extend `src/components/TraceabilityLinks.tsx`

**Implementation:**

- Record Release proposal, approval, release, and withdrawal separately from Deployment.
- Record Activation plan, activate, pause, complete, and rollback separately from Release.
- Support backend-first Deployment, later iOS/Android Deployments, then feature-flag Activation.
- Trace every operational record back to exact Release Candidate, Deliverables, Plan Baseline, Feature Specifications, and Product.

### Phase 5 acceptance tests

1. Assemble a Release Candidate from exact backend/iOS/Android artifact revisions, Product Specification baseline, and Plan Baseline; reload produces identical composition/hash.
2. Record backend Deployment success without creating a Release or Activation.
3. Record iOS and Android Deployments later and retain independent histories.
4. Approve and record a Release after required Deployment conditions pass; no Activation is created implicitly.
5. Activate a feature flag for an explicit cohort, pause it, and resume/complete or roll it back independently.
6. Traverse bidirectionally from Activation to Release Candidate to Plan Baseline to Feature/Deliverable revisions.
7. Retry each operational command with the same idempotency key and produce one transition event.
8. Display transition blockers as complete sentences and keep procedures in the appropriate operational detail area.

### Phase 5 negative paths

- A Release Candidate cannot mix Products, mutable/latest references, or unapproved required inputs.
- Synthetic demo or legacy-imported-unverified evidence cannot satisfy mandatory candidate readiness.
- Deployment success cannot automatically create or approve a Release.
- Release approval cannot imply Activation.
- Invalid state transitions, such as succeeded directly from planned when in-progress is required, are rejected and audited.
- A failed Deployment cannot satisfy a successful-deployment Release precondition.
- Activation cannot target an unreleased candidate/audience or another Product.
- Rollback appends a transition; it does not delete prior success/release/activation history.

---

## Seeded demo — persistent editable `カード会員アプリ`

**Dependencies:** Phases 1–5.

### S1 — Seed implementation

**Files:**

- add `db/seeds/software-delivery-workbench.sql`
- add `scripts/seed-software-delivery-workbench.ts`
- add seed fixtures/builders only where needed under `test/fixtures/builders.ts`
- replace target demo responsibility in `src/data.ts`; do not hard-code target domain state in React

**Requirements:**

- Seed Product `カード会員アプリ` with native Product/catalog records.
- Seed Feature A `利用限度額アップ通知` and Feature B `ホーム画面改善` with all five artifact streams and explicit review/provenance histories.
- Seed backend, iOS, and Android Deliverables, Target Systems, Environments, artifact revisions, Work Packages, and Feature–Deliverable many-to-many links.
- Seed an earlier backend Train and later mobile Train.
- Seed a shared constrained mobile review Resource so overlapping iOS/Android work creates a deterministic capacity violation.
- Tag the dataset with a stable `demo_dataset_id` without using that marker as provenance. Seed manually authored Scenarios and human decisions as `manual`, deterministic validation/comparison findings as `deterministic-derived`, fixture execution/evidence only as `synthetic-demo`, and no solver provenance.
- Seed the Product calendar as `Asia/Tokyo`, Monday–Friday 09:00–17:00, `standard_workday_minutes = 480`.
- Seed the backend Deliverable ready at 2026-04-10 17:00 and its earlier backend Train cutoff at 2026-04-10 18:00, producing a +60-minute backend margin in both Scenarios.
- Seed the conflicting Scenario with required work from 2026-04-06 09:00 through 2026-04-17 17:00, iOS review 2026-04-14 09:00–17:00, Android review 2026-04-14 13:00–17:00, one-unit shared mobile-review capacity, required mobile Deliverables ready at 2026-04-17 17:00, and mobile Train cutoff at 2026-04-17 18:00. Assert 4,800 working minutes/10.00 days, 200.0% peak utilization, per-Train margins backend +60/mobile +60 and overall minimum +60 minutes, one mandatory violation, zero mandatory unknowns, and zero deferred Deliverables.
- Seed the replanned Scenario with Android review on 2026-04-15 09:00–13:00, required mobile Deliverables ready at 2026-04-21 17:00, and mobile Train cutoff at 2026-04-22 18:00. Assert 5,760 working minutes/12.00 days, 100.0% peak utilization, per-Train margins backend +60/mobile +1,500 and overall minimum +60 minutes, zero mandatory violations/unknowns, and zero deferred Deliverables.
- Seed backend-first and mobile-later operational records with a separate feature-flag Activation.
- Seed a delay Actual and Change Event, initial baseline impact history, accepted replan decision, cloned revision, new immutable baseline, and a Baseline Replacement Event while retaining the old baseline and its final validity.
- Use explicit human-like demo actors for manual decisions without claiming authenticated identities.
- Make the seed idempotent: rerunning it does not duplicate records or overwrite user edits. Default behavior should refuse to reseed an existing Product; an explicit reset command may delete only the known demo Product in non-production environments after confirmation.

### Seed acceptance tests

1. A clean database seed creates exactly one editable `カード会員アプリ` Product and the required Features/Deliverables.
2. Product Overview exposes the Current and Target Product Specifications and both Features.
3. The original manual Scenario shows the shared Resource conflict and exactly 4,800 minutes, 200.0%, backend/mobile/overall margins +60/+60/+60, and one mandatory violation; the replanned Scenario shows 5,760 minutes, 100.0%, margins +60/+1,500/+60, and zero mandatory violations.
4. Scenario Comparison discloses the exact formulas, units, policy/calendar versions, revision ids, input hashes, and why backend-first/mobile-later differs from the conflicting plan.
5. Impact history shows delay, Direct/Transitive/Potential classifications as seeded, rationale, clone, revalidation, and new baseline.
6. Release Workspace shows backend, iOS, Android, Release, and flag Activation as distinct records.
7. Editing the demo through native resource commands persists across reload; rerunning the non-reset seed leaves edits intact.
8. Dataset records expose the stable `demo_dataset_id` while manual decisions remain `manual`, deterministic findings remain `deterministic-derived`, and fixture execution/evidence remains `synthetic-demo`.
9. No seeded mock test, GitHub fixture, Jev response, or synthetic output appears as verified evidence or an approved baseline.

### Seed negative paths

- Running the seed twice cannot duplicate Products, revisions, decisions, or events.
- The normal seed command cannot silently reset an edited demo.
- The reset command refuses production-like environments and requires explicit Product identity/confirmation.
- Seeded manual work cannot be labeled solver/AI output.
- Seeded synthetic evidence cannot satisfy mandatory verification or release readiness.

---

## Full verification and completion gate

Run verification after the seeded demo and legacy retirement candidate are complete. Preserve logs and migration reports as build artifacts, not as domain verification evidence.

### Automated commands

The implementation must make these commands available and green:

```bash
npm run build
npm run test:unit
npm run test:repository
npm run test:http
npm run test:e2e
npm test
```

Use an isolated PostgreSQL database for repository/HTTP/E2E tests. Every test creates its own Product ids or transaction/schema scope. Tests must not depend on execution order or wall-clock timing.

### Unit suite

Cover:

- immutable revision and transition matrices;
- deterministic Current + Approved Feature → Target Product Specification conflict validation;
- Product scope and reference integrity;
- cycles and explicit predecessor timing;
- sweep-line capacity at touching/overlapping boundaries;
- per-Train cutoff margin/overall-minimum/unknown propagation, Train cutoff validation, and Deliverable order;
- mandatory rule alteration and unsupported/unknown behavior;
- comparison formulas, units, rounding, and unknown propagation;
- manual/deterministic/imported/synthetic provenance;
- clone isolation;
- commit preconditions and baseline hash checks;
- impact category/path derivation;
- Release Candidate, Deployment, Release, and Activation transitions.

### PostgreSQL repository suite

Cover:

- normalized foreign keys and same-Product constraints;
- transaction rollback across domain/audit writes;
- immutable-row update/delete rejection;
- append-only review, approval, commitment, validity, actual, and operational events;
- durable command-receipt replay and key/payload conflict before/after server restart and archival; independent uniqueness prevents a second terminal decision, accepted baseline, or operational transition;
- ETag version increments;
- concurrent update conflict;
- projection rebuild equivalence;
- migration and seed idempotency.

### HTTP contract suite

Cover every `/api/v1` route for:

- valid request/response schema;
- malformed body, path, query, enum, and unknown-field rejection;
- `428` missing `If-Match`, `412` stale `If-Match`, and successful fresh update;
- idempotency replay and conflicting reuse, including replay after server restart/receipt archival;
- Product-scope violations;
- command transition/precondition failures;
- stable error envelopes with request id and finding details;
- route-specific payloads that do not leak unrelated Product data;
- `410 Gone` from retired whole-state writes.

### Playwright E2E suite

Automate the complete `カード会員アプリ` workflow:

1. Load Product Overview from PostgreSQL and confirm both Features.
2. Create a Feature artifact successor, submit review, request changes, revise, and approve.
3. Designate an exact Current Product Specification, build a Target from it, demonstrate an explicit conflict and resolve it by a new revision; prove a later Current designation does not mutate the existing Target inputs.
4. Link Features to backend/iOS/Android Deliverables and inspect bidirectional traceability.
5. Open Delivery Schedule, observe the shared Resource conflict, clone the manual Scenario, change timing, validate, and compare formulas.
6. Commit the valid Scenario through a separate human Plan decision.
7. Reload and confirm all revisions, decisions, and the Plan Baseline persisted.
8. In two browser contexts, edit one mutable resource from both; confirm context B receives and presents stale-update rejection with no lost update.
9. Record a delay, inspect Direct/Transitive/Potential paths, accept replanning, clone, validate, and commit a new baseline.
10. Confirm the old baseline remains immutable, its four-state validity history is visible, and the Baseline Replacement Event is separate from validity.
11. Assemble a Release Candidate, record backend then mobile Deployments, record Release, then separately activate the flag.
12. Navigate backward and forward across Product, Feature, Deliverable, Scenario/Baseline, impact, Release Candidate, Deployment, Release, and Activation.
13. Verify keyboard-only operation, visible focus, semantic names, error-summary focus, and no text below the design-system minimum at desktop and compact viewport widths.

### Final negative-path matrix

Before declaring completion, prove all of these fail safely with no partial write:

- cross-Product references at every aggregate boundary;
- stale update and missing precondition;
- duplicate command with altered idempotency payload, including after restart/receipt archival;
- approved revision or baseline mutation/deletion;
- commit with stale validation, mandatory violation, mandatory unknown, or advisory warning lacking rationale;
- deterministic conflict validation with absent mandatory facts;
- cycle, predecessor timing, capacity, cutoff, and Deliverable order failures;
- mandatory rule weakening;
- synthetic/imported/manual assertion presented as verified without qualifying assurance;
- impact labeled Unaffected when graph facts are incomplete;
- recommendation auto-revoking approval;
- Delivery Readiness approving a Plan;
- Deployment implying Release or Release implying Activation;
- legacy `PlanVersion`, mock test, GitHub fixture, or Jev output becoming an approved baseline/evidence;
- domain state surviving only in localStorage rather than PostgreSQL.

### Definition of done

The Software Delivery Workbench is ready for review only when:

- all five phases are complete as vertical slices;
- the editable seeded demo and delay/replan/new-baseline flow work from a clean database;
- unit, PostgreSQL repository, HTTP contract, and Playwright suites pass;
- production build passes;
- reload persistence and two-context stale rejection pass in Playwright;
- canonical hashes, disclosed seeded metric values, and staged migration reconciliation reports match;
- durable command receipts replay after restart/archive and domain uniqueness prevents duplicate irreversible outcomes;
- no authoritative domain data uses localStorage or whole-state writes;
- legacy mock/fixture/Jev/PlanVersion semantics are removed or unmistakably reframed as synthetic/unverified;
- no UI violates `AGENTS.md` or `docs/ui-design-system.md`;
- no production AI, solver, external integration, or authentication capability is claimed;
- the domain and decisions documents still match the implemented behavior, with superseding decisions recorded rather than silently drifting.
