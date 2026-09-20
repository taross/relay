# Relay domain model

## Aggregate boundary

`Release` is the consistency boundary for planning and execution. `Team`, `Component`, and reusable `VerificationDefinition` belong to the organization catalog and are referenced by immutable IDs and versions. A release stores snapshots of the referenced definitions so that a historical decision remains reproducible.

## Node types

### Team

An accountable organizational unit, not merely a group of users.

- `id`, `name`, `status`
- owned components and capabilities
- accountable roles and escalation target
- availability windows and working timezone

### Component

An independently changeable and observable part of the product.

- `id`, `name`, `kind`
- lifecycle and versioning strategy
- deployment/availability characteristics
- provided and required capabilities
- ownership edges to one or more teams

Mobile platforms, backend services and admin applications are examples, not hard-coded kinds.

### Release

A time-bounded intent to move a set of product capabilities from one known state to another.

- `id`, `name`, `objective`, `state`
- planning horizon and release windows
- included changes
- release policy set
- computed feasibility and decision trace

A release is not equivalent to one deployment. It may contain parallel, staged and delayed changes.

### Change

A proposed transition of exactly one component. A cross-component feature is represented by multiple Changes connected to the same Release and, when required, by dependency edges.

- before/after component state
- compatibility classification
- capability requirements and provisions
- owning team
- recovery mode and irreversible point

This rule preserves accountability: every `UPDATES` edge identifies one team and one component.

### ComponentReleasePlan

A release-scoped transition plan shared by all Changes for one Component. It is not duplicated per PR.

- current and target version
- cutover mode: immediate, phased, or store phased rollout
- rollout start and expected full-adoption time
- adoption milestones
- whether old and new versions may coexist directly, behind a Feature Flag, or not at all
- identifier source: store console, deployment environment, CI artifact, or manual entry

The interval between rollout start and full adoption is an explicit mixed-version state. Dependencies such as a contract migration may be gated on the end of this interval rather than on deployment start.

For mobile components the version identifier is an app version. For backend and web components it is the deployed revision or artifact identifier; a calendar date is not used as the version.

### Verification

A claim to establish about a change, component state or release outcome.

- subject and assertion
- verification method
- planned time window
- evidence requirements and freshness
- responsible team
- entry, success and stop conditions

Verification is a node because it has its own ownership, schedule, dependencies, evidence and lifecycle.

### ScheduleWindow

A temporal constraint rather than a calendar label.

- earliest/latest start
- expected duration
- fixed or movable semantics
- timezone
- predecessor/successor constraints
- external wait conditions, such as client adoption below a threshold

## Edge types

| Edge | From → To | Meaning |
| --- | --- | --- |
| `OWNS` | Team → Component | Team is accountable for the component lifecycle |
| `DELIVERS` | Team → Change | Team is accountable for this transition |
| `UPDATES` | Change → Component | Change mutates this component |
| `INCLUDES` | Release → Change | Change is evaluated in the release |
| `DEPENDS_ON` | Change → Change/Capability | Source cannot become effective first |
| `VERIFIED_BY` | Change/Component/Release → Verification | Verification establishes a required claim |
| `PERFORMED_BY` | Verification → Team | Team owns the verification result |
| `SCHEDULED_IN` | Change/Verification → ScheduleWindow | Activity is constrained to the window |
| `BEFORE` | Change/Verification → Change/Verification | Required temporal ordering |
| `GATES` | Verification → Change/Release | Target cannot advance without valid evidence |
| `RECOVERS_WITH` | Change → RecoveryAction | Available compensation path |

Edges are directed, typed, versioned and may carry constraints. Display labels are not the source of truth.

## Core invariants

1. Every Change updates exactly one Component and is delivered by exactly one accountable Team.
2. Every Release includes at least one Change.
3. Every breaking or irreversible Change is gated by at least one Verification and has an explicit recovery strategy.
4. A Verification that gates execution must be scheduled, assigned and have an unambiguous success assertion.
5. `BEFORE` and hard `DEPENDS_ON` edges must form a directed acyclic graph inside a release plan.
6. Schedule windows must admit at least one plan satisfying all hard edges and team/component availability constraints.
7. A Release is releasable only when the graph is structurally valid, policy-valid and temporally feasible.
8. `Unknown` evidence never satisfies a gate.

## Derived views

The same graph produces different useful projections without duplicating domain state:

- **Release view:** all changes, gates and time windows for one release
- **Team view:** commitments and verification load by team
- **Component view:** incoming changes, capability impacts and recovery paths
- **Schedule view:** critical path, parallel work and wait states
- **Risk view:** nodes selected by policy violations or Jev scores

## Jev decision points

Jev receives a serialized projection of the graph plus a finite typed question. Suitable decisions include:

- classify a newly described change as additive, compatible, breaking or operational
- choose which valid release shape best balances lead time and risk
- score the risk of a schedule using an explicit rubric
- estimate whether evidence warrants `continue`, `pause`, or `escalate`
- route an ambiguous constraint to one of the accountable teams reachable in the graph

Jev does not create ownership, dependency or schedule facts. It evaluates explicit alternatives. Every chosen alternative is revalidated against graph invariants and policies before it affects a release.
