# Software Delivery Workbench domain model

## Purpose and boundaries

The Software Delivery Workbench coordinates human decisions from product intent through feature definition, delivery planning, change assessment, and release operations. It is a system of record for explicit revisions, reviews, commitments, and operational transitions. It is not a source-code host, an automated approver, a solver, an AI decision maker, or an external deployment system.

The application supports multiple Products. Every Feature, Deliverable, Delivery, Train, Scenario, baseline, Change Event, Release Candidate, Deployment, Release, and Activation belongs to one Product. A Scenario scopes exactly one Product. References across Products are invalid rather than implicitly copied or shared.

PostgreSQL is authoritative for domain data. Browser storage may retain transient presentation preferences only.

## Terms and aggregate boundaries

### Product and catalog

- **Product** — stable identity and ownership boundary. It owns Features, Deliveries, Trains, Scenarios, planning policies, target systems, environments, and catalog references.
- **Product Catalog** — versioned definitions used by a Product: Teams, Resources, Resource Calendars, Target Systems, Environments, and constraint definitions. Catalog entries referenced by an immutable baseline are not rewritten in place.
- **Team** — responsible organizational unit. A Team can own Features, Deliverables, Work Packages, Resources, and operational records within a Product.
- **Resource** — a capacity-bearing person, team, service, or constrained facility. Capacity is represented as integer units in dated windows.
- **Resource Capacity Window** — one half-open `[start_at, end_at)` interval with a strictly positive integer `capacity_units`. Windows for the same Product and Resource must not overlap; PostgreSQL enforces this with an exclusion constraint over `tstzrange(start_at, end_at, '[)')`. Touching windows are legal, gaps mean capacity is unknown for the gap, and capacity is never summed or inherited across windows. `start_at >= end_at`, `capacity_units <= 0`, and overlapping inserts are rejected.
- **Target System** — deployable or affected system, such as backend, iOS, or Android.
- **Environment** — a destination or verification context such as staging or production.

A Product stores references to policy and catalog versions; it does not embed all child aggregates in one mutable document.

### Feature and artifacts

- **Feature** — a Product-scoped unit of intended behavior. It has a stable identity, lifecycle state, owner, relationships, and five independently revised artifact streams.
- **Feature Artifact Stream** — one of:
  1. Requirements
  2. Specification
  3. Solution Design
  4. Verification Planning
  5. Delivery Readiness
- **Feature Artifact Revision** — immutable content, author, provenance, revision number, canonical hash, and creation time for one stream.
- **Feature Artifact Review** — a review request and append-only decision events for an exact artifact revision.
- **Approved Feature Specification** — the immutable approved Specification revision for one Feature. Approval does not approve any Delivery Plan.
- **Feature Gate Snapshot** — an immutable record of which exact artifact revisions and review decisions satisfied a named feature gate at a point in time.
- **Verification Plan** — a revisioned Verification Planning resource containing typed Verification Cases. Each case has stable ids, subject revisions, `given` preconditions, `when` actions, `then` expected outcomes, owner, required evidence types, and lifecycle metadata. It is not an execution result.
- **Test Case Proposal** — a typed proposal with the same Given/When/Then structure. Adopting it creates a successor Verification Plan revision; adoption never means implemented, executed, or passed.
- **Verification Evidence** — a separately registered observation tied to exact subject and Verification Case revisions with truthful provenance and assurance. It is never edited inside a blocker or plan.
- **Operational Blocker** — a structured constraint with `actor_ref` or `actor_role`, `required_state`, optional `required_action_code`, exact `subject_ref`, optional typed `due_at` or numeric `threshold`, classification, and rationale requirement. The UI renders a complete sentence from these fields. Arbitrary prose is not semantically classified as a blocker or verification procedure; verification procedures exist only in typed Verification Planning resources.

Feature artifact approval and Delivery Plan commitment are distinct decisions, made against different immutable subjects. Delivery Readiness reports whether a Feature is ready to enter or continue delivery under defined criteria; it does not approve or commit the Delivery Plan.

### Product specifications

- **Current Product Specification** — at an explicit `asOf`, the exact immutable Product Specification baseline selected from eligible Current Designation Events. Approval chronology alone never makes a baseline current.
- **Product Specification Current Designation Event** — an append-only human decision that names one exact Product Specification baseline id and canonical hash, an `effective_at` instant, and a server-assigned Product-monotonic `sequence`. At `asOf`, events with `effective_at <= asOf` are eligible; the maximum `(effective_at, sequence)` wins. Thus future-effective events are excluded, a later-recorded backdated event does not displace a later-effective designation, and equal effective times resolve by sequence. Re-designation preserves prior events. Queries return the evaluated `asOf` and selected event id; commands that assemble or approve a Target require `asOf` explicitly.
- **Approved Feature Specification** — the approved immutable Specification revision for a Feature.
- **Target Product Specification** — a deterministic proposed Product specification assembled from the Current Product Specification plus an explicit ordered set of Approved Feature Specifications.
- **Product Specification Conflict** — a machine-detected, reproducible conflict between explicit claims in the inputs to a Target Product Specification.

A clean Product does not receive a hidden or seed-only Current baseline. Its initial flow is: create a non-empty Product Specification revision with at least one typed Product claim; submit that exact revision for review; record the required Product-owner approval; create an immutable Product Specification baseline; then append a Current Designation Event. An empty baseline is not permitted. Baseline creation appends `Not Evaluated` as its first validity event. Designation requires a current successful baseline validation and appends `Current` in the designation transaction. Native commands and the demo seed use this same flow.

Target assembly never silently selects one conflicting claim. Each claim uses a stable address such as a requirement key, interface field path, behavior key, or constraint key. Inputs are sorted by stable Product, Feature, stream, revision, and claim keys before validation. For each claim address, the validator emits:

- `compatible` when all values and conditions agree;
- `conflict` when two explicit values or conditions cannot both hold;
- `unknown` when required comparison data is absent or unsupported.

A conflict finding names both source revisions, the stable claim address, compared values, and validator version. A human resolves it by revising an input, explicitly deferring a Feature, or recording a scoped resolution that itself becomes revisioned input. Ordering must never decide the winner. An `unknown` mandatory claim blocks Product baseline approval just as a violated mandatory rule does. Target assembly persists the designated Current baseline id and hash used as input; a later designation cannot change or rebuild an existing Target implicitly.

### Delivery structure

- **Delivery** — a Product-scoped body of work with objectives, date horizon, Resources, Activities, Constraints, Trains, Scenarios, actuals, and replanning history.
- **Deliverable** — a revisioned output required by one or more Features. It identifies a Target System, target Environment, owning Team, Work Packages, dependencies, readiness state, artifact revision, and optional Train assignment.
- **Feature–Deliverable Link** — explicit many-to-many relationship. A Feature can require multiple Deliverables, and a Deliverable can realize multiple Features.
- **Deliverable Revision** — immutable definition of a Deliverable at a point in time, including its target, ordering needs, and Work Package references.
- **Work Package** — bounded work owned by a Team, with estimates, predecessor relationships, resource demands, and completion actuals.
- **Activity** — schedulable work with dates or windows, predecessors, resource demands, and actual execution observations.
- **Actual** — append-only observed start, finish, effort, capacity use, or completion fact, with provenance. Corrections append superseding observations instead of rewriting history.
- **Constraint** — a versioned rule applying to a Delivery, Scenario, Deliverable, Activity, Resource, Train, or transition.
- **Train** — a Product-scoped recurring or dated delivery window with cutoff, capacity, target systems/environments, and acceptance rules.

Dependencies are directed relationships between revisioned subjects. Deliverable order is explicit; it must not be inferred from list position or display order.

### Planning Policy, Scenario, validation, and commitment

- **Planning Policy** — versioned Product policy that classifies constraints as mandatory, configurable, or advisory and defines disclosed metric formulas. Mandatory rules are immutable within a policy version. Changing a mandatory rule creates a new policy version and cannot rewrite a committed baseline.
- **Scenario** — stable Product-scoped identity for a planning alternative. It scopes exactly one Product and one Delivery.
- **Scenario Revision** — immutable snapshot of Activities, predecessors, Resource demands, Deliverable order, Train assignments, constraints, policy version, and input catalog versions.
- **Scenario Provenance** — truthful origin: `manual`, `deterministic-derived`, `legacy-imported-unverified`, or a reserved future `solver-run`. A manual Scenario remains manual even if deterministic validators and metrics are later run against it.
- **Scenario Clone** — a new Scenario identity with an initial revision copied from a source revision. Subsequent edits are isolated; neither Scenario can mutate the other.
- **Validation Run** — immutable evaluation of one exact Scenario revision under one validator-set version and explicit `asOf` time.
- **Validation Finding** — one `satisfied`, `violated`, or `unknown` result with subject references, severity, rule classification, reason, and remediation context.
- **Scenario Comparison** — reproducible comparison of exact Scenario revisions with formulas, units, input hashes, and unknown-value handling disclosed.
- **Plan Commitment Request** — a request for human approval of one exact Scenario revision and Validation Run.
- **Plan Approval Event** — append-only human decision on that request.
- **Plan Baseline** — immutable canonical snapshot created only after commitment preconditions pass and the required human approval is recorded.
- **Plan Commitment** — append-only record that identifies the approved Plan Baseline, decision maker, rationale, time, and command idempotency key.

`Scenario Revision`, `Validation Run`, `Plan Baseline`, and `Plan Commitment` are separate records. A `PlanVersion` metadata label is not a Plan Baseline.

A future solver may submit a candidate through a separate `solver-run` boundary containing engine identity, engine version, parameters, canonical input hash, output hash, and logs. Until such an adapter exists, the workbench makes no solver claim. Existing deterministic heuristics may create `deterministic-derived` candidates only.

#### Initial comparison metrics

All planning instants are stored as UTC instants and displayed in the Product’s IANA timezone. Activity and capacity windows are half-open `[start, end)` intervals; when events share an instant, ending demand is removed before starting demand is added. The Product calendar defines working windows and `standard_workday_minutes` (480 in the seeded demo). Exact integer minutes and rational utilization values are authoritative; display rounding is decimal half-up.

- **Completion instant** — maximum `finish_at` among included required Activities. Unit: UTC instant. Result is `unknown` if any required Activity lacks a finish.
- **Elapsed working minutes** — Product-calendar working minutes from the minimum included required Activity start through the completion instant. Unit: integer minutes. Displayed working days equal minutes divided by `standard_workday_minutes`, rounded to two decimals. Missing start, finish, calendar, or timezone yields `unknown`.
- **Peak constrained Resource utilization** — for each Resource sweep interval, `sum(demand_units) / capacity_units`; compare exact rationals by cross multiplication, then take the maximum across constrained Resources. Display as percent rounded to one decimal. Missing or non-positive capacity, demand window, or unit compatibility yields `unknown`, not zero or unlimited capacity.
- **Train cutoff margin** — calculated per Train: `train.cutoff_at - max(ready_at)` for all required Deliverables assigned to that exact Train. Unit: signed integer elapsed minutes; positive is early and negative is late. The comparison reports the keyed per-Train margins and an overall minimum margin. If any required Deliverable lacks a Train assignment or readiness, or an assigned Train lacks a cutoff, its entry and the overall value are `unknown` (known Train margins remain disclosed). A Train with no required Deliverables is omitted.
- **Mandatory violations and unknowns** — two integer counts of distinct mandatory Validation Findings by finding id; unknown findings are never folded into violations or zero.
- **Advisory warnings and unknowns** — two integer counts of distinct advisory findings by finding id. A rationale affects permission to proceed, not the count.
- **Deferred Deliverables** — count of included Product-scoped Deliverables with an explicit deferred decision in the Scenario revision. An absent inclusion/defer decision yields `unknown`.

A Scenario Comparison names its exact revisions, metric-definition version, policy/calendar versions, input hashes, exact values, display values, keyed Train margins, overall cutoff minimum, and reasons for every `unknown`.

### Change and impact

- **Change Event** — append-only statement that an observed or proposed change affects an exact Product-scoped subject revision. It records source, actor, time, reason, and old/new facts where known.
- **Change Set** — explicit grouping of Change Events used for impact assessment and replanning.
- **Impact Edge** — rebuildable projection edge derived from normalized authoritative relationships; it is not the source of truth.
- **Impact Assessment** — immutable assessment of a Change Set against exact baseline revisions, validator version, graph version, and `asOf` time.
- **Impact Recommendation** — human-facing recommendation to `accept`, `defer`, or `reject`. A recommendation never auto-revokes an approval or baseline.
- **Baseline Validity Event** — append-only event changing the interpreted validity of an immutable baseline while preserving the baseline itself.
- **Baseline Replacement Event** — append-only relation from one immutable baseline to the exact newly committed baseline that replaces it for future planning. It is lifecycle metadata, not a validity state and not a content mutation.

Impact categories are:

- **Direct** — the changed subject is part of, constrains, or directly references the assessed subject.
- **Transitive** — a path of authoritative relationships connects a Direct impact to the assessed subject; the reason path is disclosed.
- **Potential** — a path may exist or required facts are unknown, unsupported, or conditional; the uncertainty is disclosed.
- **Unaffected** — the complete evaluated graph demonstrates no qualifying path under the recorded validator and graph versions.

Absence of data is not `Unaffected`; it is `Potential` or an `unknown` finding.

Each impact projection build has an immutable **Impact Projection Build Manifest** containing `graph_version`, builder version, `status` (`building`, `succeeded`, or `failed`), transaction snapshot id, per-authoritative-table high-water sequence, the complete versioned set of included relationship kinds, per-kind source row counts and canonical SHA-256 checksums, total node/edge counts, aggregate checksum, and start/completion times. An Impact Assessment references one manifest and its exact snapshot. `Unaffected` is legal only when the manifest is `succeeded`, every relationship kind required by the assessment policy is present, all counts/checksums reconcile, and no authoritative high-water mark has advanced beyond the assessment snapshot. A building, failed, interrupted, stale, checksum-mismatched, or relationship-kind-incomplete projection can still disclose known Direct/Transitive paths but classifies a no-path result as `Potential`, never `Unaffected`.

### Release operations

- **Release Candidate** — an immutable candidate composition referencing exact Deliverable artifact revisions, Product specification baseline, Plan Baseline, and readiness evidence. It can be assembled, evaluated, accepted, or rejected.
- **Deployment** — an attempt to place one Release Candidate into one Environment. It records execution observations and can be planned, in progress, succeeded, failed, or rolled back.
- **Release** — a business/operational decision that a successfully deployed Release Candidate is releasable for a defined audience. It can be proposed, approved, released, or withdrawn.
- **Activation** — an independently controlled exposure of released capability, such as a feature flag cohort. It can be planned, active, paused, completed, or rolled back.

A successful Deployment does not itself create a Release. A Release does not imply Activation. Backend deployment, later iOS/Android availability, and later flag Activation are represented by separate records and transitions.

All transition commands require `Idempotency-Key`. A retry with the same key and request hash returns the original result; a new key whose source state is no longer legal returns `409 INVALID_TRANSITION`.

#### Release Candidate transitions

| Command | Source → target | Prerequisites | Terminal behavior |
| --- | --- | --- | --- |
| `assemble-release-candidate` | none → Assembled | Exact Product Specification baseline, Plan Baseline, Deliverable revisions, and evidence references share Product scope | Composition becomes immutable |
| `evaluate-release-candidate` | Assembled → Evaluated | Current deterministic readiness run; mandatory unknown/violation blocks | Not terminal |
| `accept-release-candidate` | Evaluated → Accepted | One eligible Release Manager decision under the decision policy | Accepted is terminal for this candidate |
| `reject-release-candidate` | Assembled or Evaluated → Rejected | One eligible Release Manager decision with rationale | Rejected is terminal; reconsideration creates a new candidate |

#### Deployment transitions

| Command | Source → target | Prerequisites | Terminal behavior |
| --- | --- | --- | --- |
| `plan-deployment` | none → Planned | Accepted Release Candidate and exact Environment | Not terminal |
| `start-deployment` | Planned → In Progress | Required environment/readiness facts are satisfied | Not terminal |
| `record-deployment-success` | In Progress → Succeeded | System-observed or manual observation with assurance | Succeeded allows rollback but no second completion |
| `record-deployment-failure` | In Progress → Failed | Failure observation and rationale | Failed is terminal; retry is a new Deployment attempt |
| `rollback-deployment` | Succeeded → Rolled Back | Rollback observation and rationale | Rolled Back is terminal |

#### Release transitions

| Command | Source → target | Prerequisites | Terminal behavior |
| --- | --- | --- | --- |
| `propose-release` | none → Proposed | Accepted candidate and required successful Deployments | Not terminal |
| `approve-release` | Proposed → Approved | One eligible Release Manager decision | Not terminal |
| `record-release` | Approved → Released | Audience and effective time are explicit; required Deployments remain succeeded | Released may only transition to Withdrawn |
| `withdraw-release` | Approved or Released → Withdrawn | Release Manager rationale | Withdrawn is terminal; re-release creates a new Release |

#### Activation transitions

| Command | Source → target | Prerequisites | Terminal behavior |
| --- | --- | --- | --- |
| `plan-activation` | none → Planned | Released Release and explicit capability/cohort | Not terminal |
| `activate` | Planned → Active | Activation checks satisfied | Not terminal |
| `pause-activation` | Active → Paused | Operations Controller rationale | Not terminal |
| `resume-activation` | Paused → Active | Activation checks re-evaluated | Not terminal |
| `complete-activation` | Active → Completed | Completion observation | Completed is terminal |
| `rollback-activation` | Active or Paused → Rolled Back | Operations Controller rationale | Rolled Back is terminal |

## Relationships and cardinality

```text
Product 1 ── * Feature
Product 1 ── * Delivery
Product 1 ── * Train
Product 1 ── * Scenario
Feature * ── * Deliverable          (through Feature–Deliverable Link)
Feature 1 ── 5 Artifact Streams
Artifact Stream 1 ── * Artifact Revision
Artifact Revision 1 ── * Review Requests / Review Events
Delivery 1 ── * Deliverable
Delivery 1 ── * Scenario
Scenario 1 ── * Scenario Revision
Scenario Revision 1 ── * Validation Run
Committed Scenario Revision 1 ── 1 Plan Baseline
Plan Baseline 1 ── * Baseline Validity Event
Change Set 1 ── * Change Event
Change Set 1 ── * Impact Assessment
Release Candidate * ── * Deliverable Revision
Release Candidate 1 ── * Deployment
Release Candidate 1 ── * Release
Release 1 ── * Activation
```

Each relationship is Product-scoped. Database constraints and application validation reject a child whose `product_id` differs from any referenced parent.

## Review state and baseline validity

Review workflow and baseline validity answer different questions and must never share one mutable status field.

### Review state

Review state applies to a specific revision and is derived from append-only review events:

- **Not Started** — no draft review request exists for the revision.
- **Draft** — review preparation exists but has not been submitted.
- **In Review** — a review request for the exact revision is open.
- **Changes Requested** — a reviewer requested changes; the reviewed revision remains immutable and a response requires a new revision.
- **Approved** — the exact revision received the required human approval.
- **Superseded** — a newer approved revision or explicit supersession event replaced this revision for future use.

Typical transitions are:

```text
Not Started → Draft → In Review → Approved
                         ↘ Changes Requested → new revision: Draft
Approved → Superseded
```

There is no transition that edits an Approved revision back into Draft.

### Baseline validity

Validity applies to an immutable approved baseline and is derived from Baseline Validity Events:

- **Current** — no known accepted change invalidates the baseline under the recorded assessment context.
- **Impacted** — a Change Event has a Direct, Transitive, or unresolved Potential effect requiring a human decision.
- **Invalid** — a human decision or mandatory validation confirms the baseline can no longer govern the intended operation.
- **Not Evaluated** — no applicable, current impact assessment exists, or required facts are unknown.

Typical transitions are:

```text
Not Evaluated → Current
Current → Impacted → Current       (change accepted without rebaseline, with rationale)
Current → Impacted → Invalid
Impacted or Invalid → Current      (only after a recorded assessment establishes renewed validity)
```

Replacement is not a fifth validity state. A Baseline Replacement Event links the old baseline to an exact newly committed baseline; the old baseline retains its final validity and immutable history. Approval history remains unchanged when validity changes or a replacement is recorded. Accepting, deferring, or rejecting an impact recommendation appends a decision; it does not erase approval or mutate the baseline.

## Validation semantics

Each validator evaluates a canonical immutable input and returns `satisfied`, `violated`, or `unknown`. A result includes validator id/version, rule classification, exact subjects and revisions, input SHA-256, explicit `asOf`, message, structured details, and deterministic remediation category. Validators must not read wall-clock time, random values, network state, browser locale, or unordered collection iteration.

Constraint classes behave as follows:

- **Mandatory** — cannot be disabled or altered within a policy version. `violated` or `unknown` blocks commitment and any dependent operational transition.
- **Configurable** — can be configured only through an explicit policy revision and is evaluated as configured.
- **Advisory** — does not block, but proceeding after `violated` or `unknown` requires an explicit human rationale tied to the exact finding.

Required validators include:

1. **Product scope** — all referenced subjects belong to the Scenario Product.
2. **Reference integrity** — all referenced revisions, Resources, Trains, systems, environments, and policies exist.
3. **Dependency cycle** — Activity, Work Package, and Deliverable predecessor graphs are acyclic.
4. **Predecessor timing** — a successor does not begin before required predecessor completion, including observed actuals.
5. **Capacity** — a sweep-line evaluation checks integer Resource demand against capacity for every interval; overlapping demand is not approximated by anchor dates.
6. **Train cutoff** — required readiness and artifact revisions exist by the assigned Train cutoff.
7. **Deliverable order** — explicit order constraints hold across Target Systems and Environments.
8. **Mandatory constraint alteration** — a Scenario or policy revision has not removed, weakened, or overridden immutable mandatory rules.
9. **Baseline mutation** — canonical content for an approved baseline still matches its server-generated SHA-256; update/delete attempts are rejected.
10. **Commit preconditions** — exact revisions are approved where required, mandatory findings are satisfied, advisory exceptions carry rationale, and the Validation Run is current for the Scenario revision.
11. **Product specification conflict** — Target Product Specification inputs have no explicit conflict or mandatory unknown.
12. **Operational transition** — Release Candidate, Deployment, Release, and Activation prerequisites are satisfied independently.
13. **Provenance assurance** — unknown, manual assertion, synthetic demo output, and verified observation remain distinguishable.

Unsupported constraint kinds return `unknown`; they never default to `satisfied`. Verified means the declared assurance and verification method succeeded for the exact subject revision. Unknown means the workbench cannot establish the fact. A URL, imported fixture, or user-entered assertion is not verified merely because it exists.

## Provenance and human decisions

Every assertion, revision, observation, and decision records:

- source kind: `manual`, `deterministic-derived`, `legacy-imported-unverified`, `system-observed`, or `synthetic-demo`;
- asserting actor;
- recorded time and, when different, observed time;
- exact subject identity and revision;
- change reason;
- optional external reference;
- assurance level and verification method.

Manual Scenarios and records are first-class and editable through new revisions. Their provenance must remain `manual`; running deterministic validation does not relabel their origin. Imported legacy data remains `legacy-imported-unverified` until a human creates and approves a native revision. Synthetic demo execution cannot satisfy mandatory verification evidence.

Human decisions are explicit append-only events with actor, role, exact subject revision, decision, rationale, timestamp, and idempotency key. Warnings require rationale before a user can proceed. The system may recommend `accept`, `defer`, or `reject`, but it does not choose or revoke approval automatically.

For this experiment, every write receives asserted development identity from the required `X-Workbench-Actor-Id` and `X-Workbench-Actor-Role` headers. Runtime schemas validate non-empty ids and the role enum, and audit records preserve both. This is a trusted local transport for attribution only, not authentication or authorization; the UI and tests must not claim otherwise.

### Human decision policy

One terminal decision means one append-only terminal event for one exact request/subject. Database uniqueness enforces the count independently of idempotency.

| Decision | Eligible asserted role; count | Self-decision | Rationale | Successor/rejection semantics and resulting event |
| --- | --- | --- | --- | --- |
| Feature artifact review | `feature-reviewer`; exactly one terminal `approve` or `request-changes` per review request | Revision author cannot decide | Required for `request-changes`; optional for clean approval, required when overriding advisories | Approval derives Approved; requested changes closes the request and requires a successor revision/new request |
| Product Specification review/baseline | `product-owner`; exactly one terminal decision | Revision author cannot approve | Required | `request-changes` requires a successor revision; approval permits one immutable baseline for that revision; baseline starts with `Not Evaluated` |
| Current Product Specification designation | `product-owner`; exactly one designation event per command | Allowed because it selects among independently approved baselines | Required | Appends designation and, after current validation, the baseline’s `Current` validity event; later re-designation never mutates prior events |
| Plan commitment | `delivery-manager`; exactly one terminal `approve` or `reject` per Commitment Request | Scenario revision author cannot approve | Always required, including advisory dispositions | Approval transaction creates one Plan Baseline, Plan Commitment, and first `Current` validity event; rejection is terminal for the request and a successor requires a new request/revision |
| Impact recommendation response | `product-owner` or `delivery-manager`; exactly one `accept`, `defer`, or `reject` per assessment recommendation | Allowed; recommendation is deterministic, not authored by the actor | Always required | Terminal for that assessment; reassessment creates a new recommendation. Never auto-revokes approval |
| Release Candidate decision | `release-manager`; exactly one `accept` or `reject` | Candidate assembler cannot decide | Always required | Accepted/Rejected is terminal; reconsideration assembles a new candidate |
| Release approval/withdrawal | `release-manager`; one approval event; each withdrawal command once | Proposer cannot approve; releasing actor may withdraw | Required | Approval permits record-release; withdrawal is terminal and re-release creates a new Release |
| Activation control | `operations-controller`; one event per legal transition | Allowed | Required for pause or rollback; optional for activate/resume/complete absent warnings | Follows the Activation transition table; Completed/Rolled Back are terminal |

## Canonical serialization and command execution

All authoritative hashes use **`sdw-c14n-v1`**. The SHA-256 preimage is UTF-8 bytes of `sdw-c14n-v1\n` followed by canonical JSON for the envelope `{ "schema": "<resource>@<integer-version>", "product_id": "<id>", "subject_id": "<id-or-command-scope>", "content": <value> }`.

Canonical JSON rules are exhaustive: object keys are normalized to Unicode NFC and sorted by Unicode code point; duplicate keys after normalization are rejected; strings and ids are NFC; booleans and `null` use JSON literals; integers use minimal base-10 form with no leading zeros and `-0` normalized to `0`; floating-point values are forbidden; ratios/decimals are objects of reduced signed integer numerator and positive integer denominator; instants are UTC `YYYY-MM-DDTHH:mm:ss.SSSZ`; dates are `YYYY-MM-DD`; arrays preserve semantically ordered input, while set-like collections are sorted by schema-declared stable tuples before serialization. Non-finite numbers, locale-formatted values, omitted-vs-null ambiguity, and unregistered fields are rejected.

The versioned schema registry defines hash content:

| Hash | Included canonical content | Excluded metadata |
| --- | --- | --- |
| Revision/baseline | Product/subject ids, schema version, predecessor hash, typed domain content, meaning-bearing provenance (`source_kind`, observed time, assurance, external reference), and exact input ids/hashes/policy/validator versions for baselines | Hash itself, database row id unrelated to subject identity, ETag, audit/receipt ids, creator display name, `created_at`, `updated_at` |
| Validation input | Subject id/hash, catalog and policy ids/hashes, validator-set version, explicit `asOf` | Run id, execution duration, recorded time |
| Scenario comparison | Left/right revision ids/hashes, metric-definition/calendar/policy versions, explicit `asOf` | Projection id, UI display preferences |
| Idempotency request | Product id, command kind/version, route ids, asserted actor id/role, canonical request body, and relevant `If-Match` value | `Idempotency-Key`, request id, transport headers unrelated to actor/concurrency |

An idempotent command executes in one PostgreSQL transaction: insert/reserve the unique receipt `(product_id, actor_id, command_kind, idempotency_key)` with request hash and `in_progress`, or block on and lock the existing row; reject a different hash with `409 IDEMPOTENCY_KEY_REUSED`; return the stored status/body/outcome for `completed`; otherwise perform invariant checks and domain mutation, append audit, store exact outcome reference/status/response, mark the receipt `completed`, and commit. A crash before commit rolls back reservation, mutation, audit, and completion together; retry executes once. A concurrent same-key insert blocks then replays the committed outcome. Domain uniqueness remains a second defense.

## Revision, concurrency, and immutability invariants

1. Approved artifact revisions, committed Scenario revisions, Plan Baselines, Product specification baselines, Release Candidates, and recorded operational events are immutable.
2. Editing immutable content creates a new revision with a new server-generated canonical hash and an explicit predecessor; no `UPDATE` changes its content.
3. Baseline validity changes by append-only event, not by rewriting baseline content or approval history.
4. Mutable resource updates require optimistic concurrency. The server returns an ETag and requires `If-Match`; missing preconditions return `428`, stale preconditions return `412`, and no silent merge occurs.
5. Revision creation, review decisions, commitments, impact decisions, and operational commands require an idempotency key. Repeating the same key and payload returns the original result; reusing it with a different payload is rejected. For irreversible append-only commands, the key, request hash, and outcome reference remain in a durable command-receipt ledger for at least as long as the outcome exists; archival may move but never discard the uniqueness record. Domain uniqueness constraints independently prevent a second terminal decision, baseline for the same accepted commitment request, or duplicate transition event for the same command receipt.
6. Canonical hashes are generated by the server with `sdw-c14n-v1` and its registered content schema. Client hashes and legacy `graphRevision` values are never authoritative.
7. Scenario cloning copies values into a new identity; no mutable rows are shared between source and clone.
8. Actuals and audit records are append-only. Corrections identify the superseded event.
9. Read models, impact edges, and comparison projections can be rebuilt from authoritative normalized records.
10. PostgreSQL is authoritative. Reloading or opening another browser context reads the same committed state from resource APIs.

## Seeded demonstration domain

The editable demonstration seed is persisted in PostgreSQL and carries a separate `demo_dataset_id` marker. Record-level provenance remains truthful: manually authored Scenarios and human decisions are `manual`, deterministic findings are `deterministic-derived`, and fixture execution/evidence observations are `synthetic-demo`. The dataset marker never changes source provenance. The seed is ordinary domain data, not hard-coded UI state and not approved production evidence.

- Product: **カード会員アプリ**
- Feature A: **利用限度額アップ通知**
- Feature B: **ホーム画面改善**
- Deliverables: backend API/service artifact, iOS application artifact, Android application artifact
- Relationship: both Features link to applicable backend/mobile Deliverables through explicit many-to-many links
- Work: backend-first implementation, then mobile work, then independent flag Activation
- Resource condition: iOS and Android Work Packages overlap on a shared constrained mobile review Resource, producing a deterministic capacity violation
- Train condition: backend can meet an earlier Train while mobile Deliverables target a later Train
- Operational sequence: backend Deployment succeeds; iOS and Android Deployments follow; Release is recorded; feature flag Activation occurs separately
- Change flow: a mobile delay is recorded as an Actual and Change Event; the committed Plan Baseline becomes Impacted; a human accepts replanning; the Scenario is cloned; timing is revised; validation runs again; a new Plan Baseline is committed; a Baseline Replacement Event links old to new while the old baseline remains immutable and retains its final validity
- Calendar: `Asia/Tokyo`, Monday–Friday 09:00–17:00, `standard_workday_minutes = 480`
- Capacity/Train constants: shared mobile review Resource capacity is one unit in a non-overlapping window covering 2026-04-06 09:00 through 2026-04-22 18:00; backend Deliverable readiness is 2026-04-10 17:00 and `TRAIN-BE-2026-04-10` cuts off 2026-04-10 18:00 (+60 minutes)
- **`SCENARIO-CONFLICT` revision `SCR-CONFLICT-R1`** (`manual`): no clone source; required work starts 2026-04-06 09:00 and completes 2026-04-17 17:00; iOS review is 2026-04-14 09:00–17:00 and Android review is 2026-04-14 13:00–17:00 at one unit each; both mobile Deliverables are ready 2026-04-17 17:00 and assigned to `TRAIN-MOBILE-2026-04-17` cutoff 2026-04-17 18:00. Metrics are 4,800 working minutes/10.00 days, peak 2/1 (200.0%), Train margins backend +60/mobile +60/overall +60, one mandatory capacity violation, zero mandatory unknowns, zero deferred Deliverables. It is comparison-only and cannot have a Commitment Request or Plan Baseline.
- **`SCENARIO-INITIAL` revision `SCR-INITIAL-R1`** (`manual`): isolated clone of `SCR-CONFLICT-R1`; Android review moves to 2026-04-15 09:00–13:00, while completion/readiness and both Train assignments/cutoffs remain 2026-04-17 17:00/+60. Metrics are 4,800 working minutes/10.00 days, peak 1/1 (100.0%), Train margins backend +60/mobile +60/overall +60, zero mandatory violations, zero mandatory unknowns, zero deferred Deliverables. `VALIDATION-INITIAL` validates this revision; `COMMITMENT-INITIAL` creates immutable `PLAN-BASELINE-INITIAL` with first validity Current.
- **`SCENARIO-REPLAN` revision `SCR-REPLAN-R1`** (`manual`): isolated clone of committed `SCR-INITIAL-R1` only after an Actual and Change Event record the Android packaging delay. Android review moves to 2026-04-20 09:00–13:00; required mobile Deliverables become ready 2026-04-21 17:00 and move to `TRAIN-MOBILE-2026-04-22` cutoff 2026-04-22 18:00. Completion is 2026-04-21 17:00; metrics are 5,760 working minutes/12.00 days, peak 1/1 (100.0%), Train margins backend +60/mobile +1,500/overall +60, zero mandatory violations, zero mandatory unknowns, zero deferred Deliverables. `VALIDATION-REPLAN` and `COMMITMENT-REPLAN` create `PLAN-BASELINE-REPLAN`; a Baseline Replacement Event links `PLAN-BASELINE-INITIAL` to it without mutation.
- Each Scenario revision, validation input, comparison, and baseline has an exact `sdw-c14n-v1` SHA-256 recorded in the committed seed expectation manifest; tests recompute those 64-hex values from production canonical schemas rather than accepting seed-supplied hashes

These expected values use the authoritative formulas above, making Scenario comparison reproducible. Users can edit the seed by creating native revisions, and edits persist across reloads.

## Audit questions the model must answer

The normalized records and append-only history must answer, without consulting browser-local state:

- Which approved Feature Specification revision contributed each claim in a Target Product Specification?
- Which Feature and Deliverable revisions are included in a Release Candidate?
- Who approved an artifact or committed a Plan Baseline, against which exact revisions, and with what rationale?
- Why is a baseline Current, Impacted, Invalid, or Not Evaluated, and what is its validity event history?
- Which Direct or Transitive relationship path caused an impact classification?
- Was a Scenario manually authored, deterministically derived, imported unverified, or produced by a future solver adapter?
- Which mandatory facts were satisfied, violated, or unknown at commitment time?
- Which stale update was rejected, and which ETag was current?
- What changed after a delay, and why was a new baseline created rather than the old one mutated?
- Which Deployment, Release, and Activation transitions occurred independently, in what order, and on whose decision?
