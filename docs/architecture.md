# Relay product architecture

## Product thesis

Relay is not a checklist or a deployment tool. It turns independently authored change contracts into a verifiable release decision and a safe release shape.

The deterministic core owns truth:

- capability and version compatibility
- dependency graph validity
- organization policies
- evidence freshness
- legal state transitions
- final `releasable / conditional / blocked / unknown` decision

Jev operates around that core as a typed decision layer. Its output is always a bounded choice, score, or boolean probability with provenance, never an untraceable release gate.

## Where Jev is used

| Product surface | Jev's role | Deterministic boundary |
| --- | --- | --- |
| Change classification | Choose the contract type from a bounded set | Schema validation and author confirmation |
| Risk evaluation | Score compatibility, schedule, recovery and ownership risk against a rubric | Policy thresholds and source facts remain deterministic |
| Release shaping | Choose among solver-produced valid shapes: split, wait, stage, or reject | Solver first proves each option satisfies constraints |
| Evidence triage | Classify observed signals as healthy, uncertain or violating | Evidence values and freshness are not mutated by Jev |
| Execution gate | Return a typed probability for pause/escalate/continue | State machine and policy thresholds alone authorize transitions |
| Exception routing | Route unresolved graph constraints to the accountable team or role | Ownership edges determine the allowed destinations |

## Where Jev is not used

- final release authorization
- policy bypass or approval substitution
- direct mutation of evidence
- direct deployment command execution
- declaring a recovery successful
- silently inferring facts that a team has not accepted

## Logical components

```text
Web UI / HTTP API
        |
Application service
   |          |
   |          +-- Jev decision port
   |                - draftContract
   |                - suggestDependencies
   |                - proposeReleaseShapes
   |                - explainDecisionTrace
   |
   +-- Deterministic domain core
          - contract validator
          - capability graph
          - policy evaluator
          - release-shape solver
          - execution state machine
          - decision trace
        |
Repositories: contracts, policies, evidence, candidates, traces
        |
Optional boundary adapters: evidence sources and command executors
```

The domain core imports no Jev SDK and no vendor integration. The application layer calls a `DecisionPort`; a Jev adapter implements it. This keeps every safety decision usable and testable when Jev is unavailable.

## Jev output contract

Every Jev decision must contain:

- primitive (`choice`, `score`, or boolean probability), options/rubric, and typed result
- source contract, policy, evidence, and trace IDs
- calibrated probabilities or confidence as supporting metadata
- generated timestamp and model/runtime identity
- validation result from the deterministic core

Jev is not used to generate free-form plans. The application constructs a finite, validated decision space and asks Jev to evaluate it.

## Prototype scope

The current UI demonstrates the intended product boundary with representative data:

- candidate-level release decision
- independent change contracts
- explicit capability requirements
- blocked breaking change
- policy/evidence-backed decision explanation
- Jev-evaluated release-shape choices
- What-if simulation
- generated dependency view

Jev responses are intentionally mocked in the prototype. A production adapter will call the hosted System One API from the server only; credentials never enter the browser.
