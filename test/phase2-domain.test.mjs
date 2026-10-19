import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { validateArtifact, validateDeliveryReadiness } from "../workbench/phase2-domain.mjs";

function workspace() {
  const requirementId = randomUUID();
  const criterionId = randomUUID();
  const specificationId = randomUUID();
  return {
    feature: { id: randomUUID() },
    phaseStates: {
      Requirements: { reviewState: "Approved" },
      Specification: { reviewState: "Approved" },
      "Solution Design": { reviewState: "Approved" },
      "Verification Planning": { reviewState: "Approved" },
    },
    requirements: [{ id: requirementId, externalKey: "REQ-1", state: "Approved" }],
    specification: { id: specificationId, title: "Behavior", behavior: "The system records the decision.", state: "Approved", criteria: [{ id: criterionId, key: "AC-1", text: "Decision is recorded", requirementRevisionIds: [requirementId] }], requirementRevisionIds: [requirementId] },
    design: { id: randomUUID(), title: "Design", summary: "Persist the decision transactionally.", state: "Approved", specificationRevisionIds: [specificationId], requirementRevisionIds: [requirementId], acceptanceCriterionIds: [criterionId] },
    verificationPlan: { id: randomUUID(), title: "Verification", state: "Approved", cases: [{ id: randomUUID(), key: "CASE-1", method: "API test", successCriteria: "Decision reloads", executionCondition: "PostgreSQL available", responsibleTeam: "QA", specificationRevisionIds: [specificationId], requirementRevisionIds: [requirementId], acceptanceCriterionIds: [criterionId] }] },
    workPackages: [],
    deliverables: [],
  };
}

test("artifact validation enforces the explicit Requirement to criterion to Design to Verification chain", () => {
  const value = workspace();
  assert.deepEqual(validateArtifact("Specification", value).map((item) => item.code), ["ARTIFACT_CONSISTENT"]);
  assert.deepEqual(validateArtifact("Solution Design", value).map((item) => item.code), ["ARTIFACT_CONSISTENT"]);
  assert.deepEqual(validateArtifact("Verification Planning", value).map((item) => item.code), ["ARTIFACT_CONSISTENT"]);

  value.design.acceptanceCriterionIds = [];
  assert.ok(validateArtifact("Solution Design", value).some((item) => item.code === "CRITERION_NOT_DESIGNED"));
  value.verificationPlan.cases[0].acceptanceCriterionIds = [];
  assert.ok(validateArtifact("Verification Planning", value).some((item) => item.code === "CRITERION_NOT_VERIFIED"));
});

test("delivery validation rejects cycles, incomplete deliverables, and Release assignment without claiming execution", () => {
  const value = workspace();
  const first = randomUUID();
  const second = randomUUID();
  value.workPackages = [
    { id: first, key: "WP-1", predecessorIds: [second], designRevisionIds: [value.design.id], verificationRevisionIds: [value.verificationPlan.id] },
    { id: second, key: "WP-2", predecessorIds: [first], designRevisionIds: [value.design.id], verificationRevisionIds: [value.verificationPlan.id] },
  ];
  value.deliverables = [{ id: randomUUID(), deliverableId: randomUUID(), name: "Service", targetSystem: "", targetEnvironment: "", artifactRevisionLabel: "", targetReleaseTrainId: randomUUID(), workPackageIds: [first], readinessConditions: [], predecessorIds: [] }];
  const codes = validateDeliveryReadiness(value).map((item) => item.code);
  assert.ok(codes.includes("WORK_PACKAGE_CYCLE"));
  assert.ok(codes.includes("RELEASE_ASSIGNMENT_OUT_OF_SCOPE"));
  assert.ok(codes.includes("DELIVERABLE_IDENTITY_INCOMPLETE"));
  assert.ok(codes.includes("READINESS_CONDITIONS_MISSING"));
});
