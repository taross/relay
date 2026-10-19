import test from "node:test";
import assert from "node:assert/strict";
import {
  assertCanApprove,
  assertReviewTransition,
  validateFeatureConsistency,
} from "../workbench/domain.mjs";

function requirement(overrides = {}) {
  return {
    id: "revision-1",
    externalKey: "REQ-001",
    title: "A titled requirement",
    text: "The system shall preserve an approved baseline.",
    referenceKeys: ["REQ-001"],
    conflicts: [],
    ...overrides,
  };
}

test("deterministic validation reports only implemented structural checks", () => {
  const findings = validateFeatureConsistency({
    requirements: [
      requirement({ id: "revision-1", externalKey: "REQ-001", title: "", referenceKeys: ["REQ-404"], conflicts: [{ targetExternalKey: "REQ-002", resolved: false }] }),
      requirement({ id: "revision-2", externalKey: "REQ-002", referenceKeys: [] }),
      requirement({ id: "revision-3", externalKey: "REQ-001", text: "", referenceKeys: [] }),
    ],
    candidates: [{ id: "candidate-1", status: "Pending" }],
  });
  const codes = new Set(findings.map((finding) => finding.code));
  assert.deepEqual(codes, new Set([
    "MISSING_TITLE",
    "BROKEN_REFERENCE",
    "UNRESOLVED_CONFLICT",
    "DUPLICATE_EXTERNAL_KEY",
    "MISSING_TEXT",
    "NO_TRACE_REFERENCE",
    "UNDISPOSITIONED_CANDIDATES",
  ]));
  assert.equal(findings.find((finding) => finding.code === "MISSING_TITLE").requirementRevisionId, "revision-1");
  assert.equal(findings.some((finding) => /semantic|AI|contradiction/i.test(finding.message)), false);
});

test("review transitions reject paths outside the explicit state machine", () => {
  assert.doesNotThrow(() => assertReviewTransition("Draft", "In Review"));
  assert.throws(() => assertReviewTransition("Draft", "Approved"), (error) => error.code === "INVALID_TRANSITION");
  assert.throws(() => assertReviewTransition("Approved", "In Review"), (error) => error.code === "INVALID_TRANSITION");
});

test("approval requires In Review, no blockers, and rationale for warnings", () => {
  const warning = [{ severity: "Warning", code: "NO_TRACE_REFERENCE", message: "A trace reference is absent." }];
  assert.throws(() => assertCanApprove("Draft", [], ""), (error) => error.code === "INVALID_TRANSITION");
  assert.throws(() => assertCanApprove("In Review", [{ severity: "Blocker" }], "because"), (error) => error.code === "VALIDATION_BLOCKED");
  assert.throws(() => assertCanApprove("In Review", warning, ""), (error) => error.code === "WARNING_RATIONALE_REQUIRED");
  assert.doesNotThrow(() => assertCanApprove("In Review", warning, "The missing upstream reference is accepted for this baseline."));
});
