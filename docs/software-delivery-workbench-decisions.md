# Software Delivery Workbench architecture and product decisions

## Document status

These decisions define the target architecture for the Software Delivery Workbench experiment on `experiment/broader-development-support`. They constrain the implementation plan in `.omo/plans/software-delivery-workbench.md`. Product code remains unchanged until a later implementation task.

Each decision is **Accepted for planning**. A later reversal requires a superseding decision record; implementation convenience is not sufficient reason to bypass one.

## Decision summary

| ID | Decision |
| --- | --- |
| SDW-001 | Build a PostgreSQL-backed modular monolith |
| SDW-002 | Make PostgreSQL the sole domain authority |
| SDW-003 | Use normalized Product-scoped resources and bounded JSONB |
| SDW-004 | Expose resource APIs and explicit command endpoints |
| SDW-005 | Require optimistic concurrency and command idempotency |
| SDW-006 | Use immutable revisions, baselines, and canonical server hashes |
| SDW-007 | Record reviews, approvals, commitments, validity, and audit as append-only events |
| SDW-008 | Separate feature artifact approval from Delivery Plan commitment |
| SDW-009 | Keep deterministic planning pure and make no solver or AI claim |
| SDW-010 | Represent manual provenance and unknown facts truthfully |
| SDW-011 | Derive impact through a rebuildable graph projection |
| SDW-012 | Separate Release Candidate, Deployment, Release, and Activation |
| SDW-013 | Use route-specific hydration and vertical slices |
| SDW-014 | Retire whole-state persistence and reframe legacy fixtures |
| SDW-015 | Add runtime validation and layered automated tests before retirement |
| SDW-016 | Do not add production auth or external integrations in this scope |

## SDW-001 — PostgreSQL-backed modular monolith

**Decision.** Implement one deployable Node application with internal modules for catalog, products, features, specifications, deliveries, planning, change impact, and release operations. Keep the React client in the same repository. Enforce module boundaries through application services and repositories rather than introducing network services.

**Reason.** The current repository already has a Node HTTP server, PostgreSQL access, and one React application. The domain requires transactional consistency across approval, validation, baseline, and audit writes. A modular monolith provides those boundaries without distributed transactions, duplicated operational tooling, or speculative service contracts.

**Consequences.**

- Domain and application modules must not import HTTP or PostgreSQL details.
- Cross-module work occurs through typed commands, queries, and stable identifiers.
- PostgreSQL transactions can atomically append a decision, create a baseline, and write audit metadata.
- Modules can be separated later if measured operational needs justify it; no separation is implied now.

**Rejected alternative.** Microservices would add failure modes and deployment complexity without a demonstrated scaling or ownership need.

## SDW-002 — PostgreSQL is the sole domain authority

**Decision.** Persist all authoritative Products, revisions, relationships, planning records, decisions, actuals, and operational events in PostgreSQL. Browser `localStorage` may hold theme, panel preferences, or an unsent form draft, but never authoritative domain state.

**Reason.** The current combination of local browser state, debounced whole-state `PUT /api/state`, and delete/reinsert persistence is last-write-wins and allows stale contexts to erase newer work. The workbench must preserve history and behave consistently across reloads and browser contexts.

**Consequences.**

- Every route hydrates through resource APIs.
- Reloading the browser reproduces the committed state.
- Domain changes are acknowledged by the server before the UI presents them as saved.
- Offline-first editing and local conflict merging are explicitly outside this scope.

**Rejected alternative.** Retaining localStorage as a second authority would require conflict reconciliation and undermine immutable audit history.

## SDW-003 — Normalized Product-scoped resources with bounded JSONB

**Decision.** Use normalized tables for identities, Product scope, relationships, revisions, transitions, constraints, and audit metadata. Use JSONB only for document-shaped revision content and structured validator details whose internal shape is runtime validated.

**Reason.** Product-scope, many-to-many Feature–Deliverable relationships, graph traversal, immutable revision references, and operational transitions must be enforceable and queryable. A single JSONB release document cannot reliably enforce those invariants.

**Consequences.**

- Every domain child carries `product_id`, and composite foreign keys or transaction checks prevent cross-Product references.
- Stable relationships such as predecessors, Resource demands, Train assignments, and baseline inputs use rows, not opaque arrays.
- JSONB schemas are versioned and validated at write boundaries.
- Read models may denormalize for UI efficiency but remain rebuildable.
- Resource Capacity Windows use positive integer units and non-overlapping half-open `[start_at, end_at)` intervals per Product/Resource, enforced with a PostgreSQL range exclusion constraint. Touching windows are legal; gaps are unknown capacity, not zero or inherited capacity.

**Rejected alternative.** Whole-aggregate JSON documents would preserve the present coupling and make constraints, migrations, and impact paths fragile.

## SDW-004 — Resource APIs and explicit commands

**Decision.** Replace whole-state replacement with `/api/v1` resource endpoints for queries and narrowly scoped command endpoints for transitions. Use HTTP semantics consistently: resources are addressed by stable ids; revisions and events are created; transition commands do not masquerade as arbitrary field updates.

Representative endpoints include:

- `GET/POST /api/v1/products`
- `GET/PATCH /api/v1/products/:productId`
- `GET/POST /api/v1/products/:productId/features`
- `GET /api/v1/features/:featureId`
- `POST /api/v1/features/:featureId/artifacts/:stream/revisions`
- `POST /api/v1/artifact-revisions/:revisionId/review-requests`
- `POST /api/v1/review-requests/:reviewId/decisions`
- `GET/POST /api/v1/products/:productId/deliveries`
- `GET/POST /api/v1/deliveries/:deliveryId/deliverables`
- `POST /api/v1/deliveries/:deliveryId/scenarios`
- `POST /api/v1/scenarios/:scenarioId/revisions`
- `POST /api/v1/scenario-revisions/:revisionId/validations`
- `POST /api/v1/scenario-revisions/:revisionId/clone`
- `POST /api/v1/scenario-revisions/:revisionId/commitment-requests`
- `POST /api/v1/commitment-requests/:requestId/decisions`
- `GET/POST /api/v1/products/:productId/change-events`
- `POST /api/v1/change-sets/:changeSetId/impact-assessments`
- `POST /api/v1/impact-assessments/:assessmentId/decisions`
- `GET/POST /api/v1/products/:productId/release-candidates`
- command endpoints beneath Release Candidates, Deployments, Releases, and Activations for their named transitions

**Reason.** Resource and command boundaries align HTTP writes with domain invariants and let each response return the affected current representation, revision id, audit id, and concurrency token.

**Consequences.**

- Runtime schemas define request and response contracts.
- The implementation plan’s route contract registry is normative: every operation names one schema module, application command/query handler, actor source, Product-scope rule, concurrency/idempotency precondition, transaction boundary, success shape, and domain errors.
- `server/index.ts` starts the process, `server/app.ts` composes middleware, and `server/api/v1/router.ts` only mounts module routers. Platform Phase P1.1 owns these files; later phases add module routers without re-owning the composition files.
- Command handlers own transition checks; generic update handlers cannot bypass them.
- Route-specific query endpoints can evolve without returning the entire database.

**Rejected alternative.** Continuing `GET/PUT /api/state` makes authorization boundaries, concurrency, validation, and incremental hydration inseparable.

## SDW-005 — Optimistic concurrency and idempotency

**Decision.** Mutable resources return strong ETags and require `If-Match` for updates. Missing preconditions return `428 Precondition Required`; stale tokens return `412 Precondition Failed` with the current resource reference. Revision creation, review decisions, commitments, change decisions, imports, and operational commands require `Idempotency-Key`.

**Reason.** Editing is expected from more than one browser context. Silent last-write-wins replacement is unacceptable, while long database locks across human editing are impractical. Retried commands must not duplicate approvals, baselines, or deployments.

**Consequences.**

- The UI handles stale responses explicitly and offers reload/reapply, not silent merge.
- Idempotency records include command kind, Product scope, scoped actor, request hash, and response reference. For irreversible append-only commands, a durable command receipt is retained for at least as long as the resulting event/baseline exists; archival may move but cannot discard the key, request hash, or outcome reference.
- Domain uniqueness constraints independently prevent a second terminal review/commitment decision, a second baseline for the same accepted commitment request, or a duplicate operational transition for one command receipt.
- Repeating a key with the same canonical request returns the original result, including after process restart or receipt archival; a different request returns a conflict.
- Approval-sensitive commands remain pessimistic in presentation until acknowledged.
- One PostgreSQL transaction reserves/locks the receipt, verifies the canonical request hash, performs the mutation, appends audit, stores the exact outcome/response, marks the receipt complete, and commits. Concurrent same-key requests block and replay; a crash rolls back every step. Tests cover simultaneous same/different payloads and crash/retry.

**Rejected alternative.** Timestamp-only checks are ambiguous; client-generated versions are not authoritative.

## SDW-006 — Immutable revisions and baselines

**Decision.** Approved Feature Artifact revisions, Scenario revisions, Product Specification baselines, Plan Baselines, Release Candidates, and recorded operational events are immutable. Edits create a successor revision. The server computes canonical SHA-256 hashes over stable serialized content.

**Reason.** A decision is meaningful only when its exact subject can be reconstructed. The current client `graphRevision` is a non-cryptographic hash over selected mutable fields and cannot identify an authoritative baseline.

**Consequences.**

- `sdw-c14n-v1` is the only initial canonicalization version. Its preimage prefix, schema envelope, NFC/key sorting, integer/rational representation, UTC date/time encoding, ordered/set array rules, included semantic fields, and excluded operational metadata are normative in the domain document and shared schema registry; floating-point and unregistered fields are rejected.
- Database permissions, triggers where appropriate, and repositories reject content updates or deletes after immutability conditions are met.
- A baseline references exact input revisions, policy version, validator version, and canonical hash.
- A clean Product authors a non-empty Product Specification revision, reviews and approves that exact revision, creates one immutable baseline with initial validity `Not Evaluated`, validates it, and designates it Current in a command that appends `Current`. Empty or seed-only bootstrap baselines are forbidden.
- Current Product Specification is selected at an explicit `asOf` from append-only designation events, never by querying the latest approval. Eligible events have `effective_at <= asOf`; maximum `(effective_at, server-assigned Product-monotonic sequence)` wins, deterministically handling future-effective, backdated, and equal-effective-time events. Existing Target assemblies retain the selected event id, `asOf`, and exact Current baseline id/hash.
- Replanning clones a committed Scenario revision, validates the clone, and creates a new baseline; a Baseline Replacement Event links old to new without introducing `Superseded` as a fifth validity state. The old baseline retains its final Current/Impacted/Invalid/Not Evaluated validity and immutable history.

**Rejected alternative.** Mutating approved records and retaining only status history cannot prove what was approved.

## SDW-007 — Append-only decisions, validity, and audit

**Decision.** Store review requests and decisions, Plan commitments, impact responses, baseline validity changes, actuals, and operational transitions as append-only events. Derive current review state and validity from event history. Write an audit event in the same transaction as each domain change.

**Reason.** Mutable status fields lose who decided what, when, why, and against which revision. Review state and baseline validity are different axes: approval history must survive later impact.

**Consequences.**

- Review states are Not Started, Draft, In Review, Changes Requested, Approved, and Superseded.
- Validity states are Current, Impacted, Invalid, and Not Evaluated.
- Corrections append superseding events rather than rewriting rows.
- Audit history includes actor, command, subject, before/after references where applicable, request/idempotency ids, and timestamp.
- The domain document’s decision-policy table is normative for approval count, eligible asserted role, self-decision, rationale, successor/rejection behavior, and resulting events. `X-Workbench-Actor-Id` and `X-Workbench-Actor-Role` provide trusted development attribution only; they are not authorization.
- Product Specification baselines begin `Not Evaluated`; a valid Current designation appends `Current`. A successful Plan commitment creates the Plan Baseline, Plan Commitment, and first `Current` validity event atomically.

**Rejected alternative.** A mutable `status` or `approved: true` field is insufficient evidence and enables accidental history loss.

## SDW-008 — Feature approval and Plan commitment are separate

**Decision.** Review the five Feature artifact streams independently, and record Feature gate snapshots separately from Plan commitment. Delivery Readiness is one Feature phase; it does not approve the Delivery Plan. A Plan commitment names one exact Scenario revision and current Validation Run and requires an explicit human decision.

**Reason.** Feature quality and schedule/resource commitment have different owners, inputs, and failure conditions. Conflating them permits a content reviewer to commit capacity or allows a schedule approval to bless incomplete specifications.

**Consequences.**

- Approved Feature Specifications can feed deterministic Target Product Specification assembly.
- Plan commitment preconditions can require approved Feature artifacts without equating those approvals to commitment.
- UI labels and audit history identify the decision type and subject explicitly.

**Rejected alternative.** A single Release approval or mutable approval object cannot represent independent accountability.

## SDW-009 — Pure deterministic planning; no solver or AI claim

**Decision.** Extract deterministic compilation, validation, heuristic candidate derivation, and comparison into pure TypeScript modules with explicit inputs. Label current candidates `deterministic-derived`; do not describe them as optimized, solver-generated, AI-generated, or externally verified. Define a future solver-run adapter boundary without implementing it.

Target seams are:

```ts
compileSchedulingModel(revision, catalog): CanonicalSchedulingModel
validateScenario(model, context): ValidationResult
derivePlanCandidates(model, policy): readonly PlanCandidate[]
compareScenarios(left, right, metricDefinitions): ScenarioComparison
```

**Reason.** Existing planning helpers contain reusable ideas, but `compileSchedulingModel` includes wall-clock output, Resource assignment shortcuts, and validators that default unsupported rules to success. Existing candidate logic is heuristic, not a solver.

**Consequences.**

- Computation receives `asOf`, validator-set version, catalog versions, and policies explicitly.
- Stable sorting, integer capacity, canonical units, and disclosed formulas produce reproducible output.
- Unsupported or missing facts produce `unknown`, never success.
- A future adapter must record engine/version, parameters, canonical input/output hashes, and execution provenance.

**Rejected alternative.** Marketing deterministic heuristics as solver or AI output would misrepresent capability and provenance.

## SDW-010 — Truthful provenance and unknown facts

**Decision.** Every assertion and generated record carries source kind and assurance. Manual work is fully supported and remains labeled manual. Synthetic demo execution, URLs, imported fixtures, and unsupported checks cannot satisfy mandatory verified-evidence requirements.

**Reason.** The current mock runner copies expected values into passing actuals, and GitHub-like data is fixture-backed. Treating either as verified evidence would create false confidence. Manual planning is legitimate, but its origin must be visible.

**Consequences.**

- Source kinds include `manual`, `deterministic-derived`, `legacy-imported-unverified`, `system-observed`, and `synthetic-demo`.
- A separate demo-dataset marker identifies seeded records without overwriting record-level provenance: seeded human decisions and manually authored Scenarios remain `manual`, while fixture execution/evidence remains `synthetic-demo`.
- Mandatory unknown facts block commitment.
- Advisory warnings require explicit rationale to proceed.
- Manual Scenarios can be cloned, compared, and committed after valid human decisions; validation does not relabel their provenance.

**Rejected alternative.** Binary pass/fail with an optimistic default obscures uncertainty and rewards missing data.

## SDW-011 — Rebuildable graph impact projection

**Decision.** Keep normalized relationships authoritative and build a versioned `impact_edges` projection for traversal. Classify impact as Direct, Transitive, Potential, or Unaffected and disclose reason paths. Recommendations are accept, defer, or reject; they never auto-revoke approval.

**Reason.** Impact analysis spans Feature, artifact, Deliverable, dependency, Scenario, baseline, and operational relationships. Traversal needs a common projection, but making the projection authoritative would duplicate relationship ownership.

**Consequences.**

- Projection jobs are deterministic and replayable from authoritative rows.
- Impact Assessments record graph version, source revisions, validator version, and paths.
- Every projection build emits an immutable manifest with transaction snapshot/high-water marks, complete relationship-kind set, builder/graph versions, per-kind source counts/checksums, node/edge counts, aggregate checksum, and building/succeeded/failed status.
- `Unaffected` is legal only from a succeeded, checksum-reconciled, relationship-complete manifest at the assessment’s exact authoritative snapshot. Interrupted, stale, failed, or kind-incomplete builds yield Potential for a no-path result while retaining any known Direct/Transitive paths.
- Missing graph data yields Potential/unknown, not Unaffected.
- A validity event is appended only through an explicit rule or human decision.

**Rejected alternative.** Hard-coded per-screen impact logic would produce inconsistent classifications and unauditable results.

## SDW-012 — Separate release-operation records

**Decision.** Model Release Candidate, Deployment, Release, and Activation as distinct records and state machines. Preserve links between them without collapsing their transitions.

**Reason.** Technical deployment, business release, and user exposure occur at different times and can fail or roll back independently. The seeded backend-first/mobile-later/flag-activation flow depends on this separation.

**Consequences.**

- A successful Deployment is a precondition input, not an automatic Release.
- A Release can exist before a cohort Activation, and an Activation can be paused or rolled back independently.
- Transition validators and audit events are specific to each record type.
- The domain transition tables are exhaustive. Release Candidate rejection is terminal and reconsideration creates a new candidate; failed Deployment retry creates a new attempt; withdrawn Release retry creates a new Release; Activation uses a distinct `resume-activation` command from Paused rather than overloading `activate`.
- Same-key retries return the original transition; a new key in an illegal source state returns `409 INVALID_TRANSITION`.

**Rejected alternative.** One release status cannot accurately represent partial deployment or staged activation.

## SDW-013 — Route-specific hydration and complete vertical slices

**Decision.** Split the monolithic React application by domain route and hydrate each route from focused read models. Implement one complete vertical slice at a time—migration, repository, domain logic, API, UI, and tests—rather than first building broad static screens.

Target information architecture:

- Product Overview
- Feature Workspace
- Delivery Schedule
- Train view
- Constraint view
- Scenario Comparison
- Impact view
- Release Workspace

Every workspace includes bidirectional traceability links between Product, Feature, artifact revision, Deliverable, Scenario/Baseline, Change Event, Release Candidate, Deployment, Release, and Activation where relationships exist.

**Reason.** Route boundaries match user tasks and allow smaller payloads. Vertical slices expose domain/API mistakes early and preserve demonstrable behavior throughout migration.

**Consequences.**

- Existing compact rectilinear design language, tokens, semantic structure, readable minimum text, and visible keyboard focus remain constraints.
- No decorative active rails, dots, oversized pills, rounded navigation cards, or active underlines are introduced.
- Active navigation uses type weight, text color, and a quiet surface change.
- Blockers are stored structurally as actor/role, required state/action, exact subject, optional typed timing/threshold, classification, and rationale requirement; complete sentences are rendered from those fields. The system never uses natural-language classification to decide whether prose is a procedure.
- Verification procedures live only in typed Verification Planning resources with Given/When/Then cases; evidence registration is a separate resource and operation.

**Rejected alternative.** A screen-first rewrite would create disconnected mocks and defer persistence and invariants until late.

## SDW-014 — Retire whole-state and reframe legacy data

**Decision.** Migrate incrementally from current JSONB/whole-state persistence, but do not dual-write indefinitely. Import legacy `FeatureChange`, `ComponentChange`, `PlanVersion`, approval objects, GitHub fixtures, Jev outputs, and mock evidence only as mapped `legacy-imported-unverified` or `synthetic-demo` records with source checksums. They are not approved baselines or verified evidence.

**Reason.** Some current data and deterministic planning ideas are useful, but their semantics do not satisfy target immutability, approval, provenance, or validation requirements. Dual authority would make cutover unverifiable.

**Consequences.**

- Migration inventory includes PostgreSQL and the browser keys `relay-teams`, `relay-components`, and `relay-releases`. Before cutover, an operator either exports browser-local data through the checksum-bearing importer with signed provenance or records signed disposal; local data is never silently ignored.
- The mapping specification covers every legacy field and nested type, deterministic Product/target ids, omissions, rejections, and legacy migration-001 bookkeeping.
- A temporary conditional ETag may protect `/api/state` during migration.
- Native resource writes begin module by module; no bidirectional dual-write is allowed.
- At each mixed-mode gate, cut domains are removed from the legacy save payload and rejected if submitted. Uncut legacy screens are read-only unless their exact allowlisted scalar fields have a bounded endpoint; no whole-state write can alter normalized rows.
- Compatibility `GET /api/state` may become a projection over normalized data for a bounded period.
- After route migration and parity verification, `PUT /api/state` returns `410 Gone`, localStorage domain keys are removed, and legacy tables are archived or dropped in a later migration.
- Jev and fixture-backed GitHub surfaces are removed or explicitly retained only as synthetic demonstration, with no production integration claim.

**Rejected alternative.** Relabeling legacy PlanVersion or mock evidence would preserve data appearance at the cost of false authority.

## SDW-015 — Runtime validation and layered automated tests

**Decision.** Validate all HTTP input and JSONB content at runtime, enforce invariants again in domain/application services and database constraints, and add unit, PostgreSQL repository, HTTP contract, and Playwright E2E suites.

**Reason.** TypeScript does not validate network input. The current repository has no automated tests, while migration touches persistence, concurrency, immutable history, and complex transitions.

**Consequences.**

- Test infrastructure and isolated PostgreSQL setup are first-class implementation work.
- Contract tests cover status codes, ETags, idempotency, validation errors, and exact resource shapes.
- E2E tests cover reload persistence and two browser contexts rejecting stale updates.
- Domain unit tests cover deterministic validators, clone isolation, comparison formulas, decision/transition matrices, canonicalization vectors, and Resource Capacity Window boundaries.
- HTTP/repository tests cover simultaneous command-receipt reservation, different-payload conflict, transaction crash/retry, and impact-manifest completeness.
- Seed SQL is limited to schema-safe static bootstrap. The seed script invokes production command/application services under a fixed clock; any historical bulk import must use an invariant-preserving transactional importer with the same canonicalization, validation, audit, receipt, and uniqueness rules.
- Legacy retirement occurs only after target-path tests pass.

**Rejected alternative.** UI-only testing would not prove database constraints, transactionality, or stale-write rejection.

## SDW-016 — No production auth or external integration in scope

**Decision.** Do not claim or implement production authentication/authorization, AI, solver execution, GitHub connectivity, deployment automation, or other external integrations in this workbench scope. Represent actors explicitly for decisions and seed/test them, but document production identity as a future boundary.

**Reason.** The requested experiment is about broader development-support domain behavior. Inventing integrations or production security would expand scope and imply capabilities the repository cannot support or verify.

**Consequences.**

- Actor identity in development is supplied through required `X-Workbench-Actor-Id` and `X-Workbench-Actor-Role` headers, runtime-validated against the decision-policy role enum, and never described as authenticated or authorized identity.
- External references are provenance metadata only.
- Future adapters must enter through bounded interfaces and preserve idempotency, runtime validation, and audit semantics.
- The absence of production auth is an explicit deployment limitation, not a hidden assumption.

**Rejected alternative.** Placeholder integrations that appear real would repeat the provenance problems of current fixtures.

## Cross-decision quality gates

Implementation is conformant only when all of the following hold:

1. No domain write depends on localStorage or whole-state replacement.
2. A second browser context receives a stale-write rejection rather than silently overwriting newer data.
3. Approved content cannot be updated or deleted; edits create linked revisions.
4. Review approval, baseline validity, and Plan commitment remain independently queryable histories.
5. Unsupported mandatory rules and missing facts block rather than pass.
6. Manual, imported, deterministic, synthetic, and future solver provenance cannot be confused.
7. Scenario clones do not share mutable children.
8. Scenario comparisons disclose formulas, units, input revisions, and unknown handling.
9. Change impact includes reason paths and never auto-revokes approval.
10. Deployment, Release, and Activation can progress and roll back independently.
11. The seeded `カード会員アプリ` workflow persists across reloads and demonstrates delay, impact, replan, and a new immutable baseline.
12. Legacy `PlanVersion`, mock tests, Jev evaluation, and GitHub fixtures are never presented as approved baselines or verified evidence.
