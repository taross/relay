import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { MemoryPhase2Repository } from "../workbench/phase2-memory-repository.mjs";
import { Phase2Service } from "../workbench/phase2-service.mjs";
import { dispatchPhase2Request } from "../workbench/phase2-api.mjs";

const command = () => randomUUID();
const actor = { actorName: "Ari Reviewer", rationale: "The deterministic checks and trace chain were reviewed." };

async function approveArtifact(service, featureId, phase) {
  let workspace = await service.getWorkspace(featureId);
  await service.requestReview(command(), featureId, phase, { expectedFeatureVersion: workspace.feature.version, expectedPhaseVersion: workspace.phaseStates[phase].version, ...actor });
  workspace = await service.getWorkspace(featureId);
  await service.approve(command(), featureId, phase, { expectedFeatureVersion: workspace.feature.version, expectedPhaseVersion: workspace.phaseStates[phase].version, ...actor, warningRationale: "" });
  return service.getWorkspace(featureId);
}

async function approvedArtifacts() {
  const requirementId = randomUUID();
  const repository = new MemoryPhase2Repository({ requirements: [{ id: requirementId, requirementId: randomUUID(), externalKey: "REQ-1", title: "Record decisions", text: "The service records each decision.", state: "Approved", version: 1 }] });
  const service = new Phase2Service(repository);
  let workspace = await service.getWorkspace(repository.state.feature.id);
  const featureId = workspace.feature.id;

  await service.saveSpecification(command(), featureId, {
    expectedFeatureVersion: workspace.feature.version, expectedPhaseVersion: workspace.phaseStates.Specification.version, expectedRevisionVersion: null,
    authorName: "Sam Author", title: "Decision behavior", behavior: "Record and reload decisions.",
    criteria: [{ key: "AC-1", text: "A saved decision reloads", requirementRevisionIds: [requirementId] }], requirementRevisionIds: [requirementId],
  });
  workspace = await approveArtifact(service, featureId, "Specification");
  const criterionId = workspace.specification.criteria[0].id;

  await service.saveDesign(command(), featureId, {
    expectedFeatureVersion: workspace.feature.version, expectedPhaseVersion: workspace.phaseStates["Solution Design"].version, expectedRevisionVersion: null,
    authorName: "Sam Author", title: "Transactional persistence", summary: "Use one transaction.", specificationRevisionIds: [workspace.specification.id], requirementRevisionIds: [requirementId], acceptanceCriterionIds: [criterionId],
  });
  workspace = await approveArtifact(service, featureId, "Solution Design");

  await service.saveVerificationPlan(command(), featureId, {
    expectedFeatureVersion: workspace.feature.version, expectedPhaseVersion: workspace.phaseStates["Verification Planning"].version, expectedRevisionVersion: null,
    authorName: "Sam Author", title: "Decision checks", cases: [{ key: "CASE-1", method: "API test", successCriteria: "Saved content reloads", executionCondition: "Repository seam", responsibleTeam: "QA", specificationRevisionIds: [workspace.specification.id], requirementRevisionIds: [requirementId], acceptanceCriterionIds: [criterionId] }],
  });
  workspace = await approveArtifact(service, featureId, "Verification Planning");
  return { repository, service, featureId, requirementId, criterionId, workspace };
}

test("Phase 2 service persists the trace chain, freezes a readiness snapshot, and impacts history after a successor", async () => {
  const fixture = await approvedArtifacts();
  let { workspace } = fixture;
  const { service, featureId, requirementId } = fixture;

  await service.saveWorkPackage(command(), featureId, null, {
    expectedFeatureVersion: workspace.feature.version, expectedPhaseVersion: workspace.phaseStates["Delivery Readiness"].version, expectedVersion: null, key: "WP-1", type: "development", description: "Implement transactional persistence", owningTeam: "Platform", predecessorIds: [], designRevisionIds: [workspace.design.id], verificationRevisionIds: [workspace.verificationPlan.id],
  });
  workspace = await service.getWorkspace(featureId);
  await service.saveDeliverable(command(), featureId, null, {
    expectedFeatureVersion: workspace.feature.version, expectedPhaseVersion: workspace.phaseStates["Delivery Readiness"].version, expectedVersion: null, name: "Decision service", description: "Deployable service", targetSystem: "decision-api", targetEnvironment: "production", artifactRevisionLabel: "build-1", targetReleaseTrainId: null, authorName: "Sam Author", workPackageIds: [workspace.workPackages[0].id], predecessorIds: [], readinessConditions: [{ key: "READY-1", text: "Artifact is available" }],
  });
  workspace = await service.getWorkspace(featureId);
  await service.requestReview(command(), featureId, "Delivery Readiness", { expectedFeatureVersion: workspace.feature.version, expectedPhaseVersion: workspace.phaseStates["Delivery Readiness"].version, ...actor });
  workspace = await service.getWorkspace(featureId);
  await service.approve(command(), featureId, "Delivery Readiness", { expectedFeatureVersion: workspace.feature.version, expectedPhaseVersion: workspace.phaseStates["Delivery Readiness"].version, ...actor, warningRationale: "" });
  workspace = await service.getWorkspace(featureId);
  assert.equal(workspace.readinessBaselines.length, 1);
  assert.equal(workspace.readinessBaselines[0].validity, "Current");
  assert.equal(workspace.deliverables[0].state, "Approved");

  const frozenSpecificationId = workspace.specification.id;
  await service.saveSpecification(command(), featureId, {
    expectedFeatureVersion: workspace.feature.version, expectedPhaseVersion: workspace.phaseStates.Specification.version, expectedRevisionVersion: workspace.specification.version,
    authorName: "Sam Author", title: "Decision behavior v2", behavior: "Record, reload, and audit decisions.", criteria: [{ key: "AC-1", text: "A saved decision reloads", requirementRevisionIds: [requirementId] }], requirementRevisionIds: [requirementId],
  });
  workspace = await service.getWorkspace(featureId);
  assert.notEqual(workspace.specification.id, frozenSpecificationId);
  assert.equal(workspace.specification.predecessorRevisionId, frozenSpecificationId);
  assert.equal(workspace.readinessBaselines[0].validity, "Impacted");
  assert.equal(workspace.artifactBaselines.find((item) => item.phase === "Specification").validity, "Impacted");
  assert.equal(workspace.artifactBaselines.find((item) => item.phase === "Solution Design").validity, "Impacted");
});

test("Phase 2 service rejects stale versions, invalid Release assignment, and changed idempotent payloads", async () => {
  const { service, featureId, workspace } = await approvedArtifacts();
  await assert.rejects(() => service.saveWorkPackage(command(), featureId, null, {
    expectedFeatureVersion: workspace.feature.version - 1, expectedVersion: null, key: "WP-1", type: "QA", description: "Test", owningTeam: "QA", predecessorIds: [], designRevisionIds: [], verificationRevisionIds: [],
  }), (error) => error.code === "STALE_VERSION" && error.status === 409);
  assert.throws(() => service.saveDeliverable(command(), featureId, null, {
    expectedFeatureVersion: workspace.feature.version, expectedPhaseVersion: workspace.phaseStates["Delivery Readiness"].version, expectedVersion: null, name: "Artifact", description: "", targetSystem: "svc", targetEnvironment: "prod", artifactRevisionLabel: "1", targetReleaseTrainId: randomUUID(), authorName: "Author", workPackageIds: [], predecessorIds: [], readinessConditions: [],
  }), (error) => error.code === "RELEASE_ASSIGNMENT_OUT_OF_SCOPE");

  const key = command();
  const input = { expectedFeatureVersion: workspace.feature.version, expectedPhaseVersion: workspace.phaseStates["Delivery Readiness"].version, expectedVersion: null, key: "WP-1", type: "development", description: "Implement", owningTeam: "Team", predecessorIds: [], designRevisionIds: [workspace.design.id], verificationRevisionIds: [workspace.verificationPlan.id] };
  const first = await service.saveWorkPackage(key, featureId, null, input);
  const replay = await service.saveWorkPackage(key, featureId, null, input);
  assert.equal(first.body.workPackages[0].id, replay.body.workPackages[0].id);
  assert.equal(replay.replayed, true);
  await assert.rejects(() => service.saveWorkPackage(key, featureId, null, { ...input, description: "Changed" }), (error) => error.code === "IDEMPOTENCY_KEY_REUSED");
});

test("Phase 2 API validates trace payloads and exposes no route that assigns a Release Train", async () => {
  const { service, featureId, workspace } = await approvedArtifacts();
  await assert.rejects(() => dispatchPhase2Request({
    method: "PUT", url: `/api/workbench/features/${featureId}/design`, headers: { "idempotency-key": command() }, body: {
      expectedFeatureVersion: workspace.feature.version, expectedPhaseVersion: workspace.phaseStates["Solution Design"].version, expectedRevisionVersion: workspace.design.version,
      authorName: "Author", title: "Design", summary: "Summary", specificationRevisionIds: [workspace.specification.id], requirementRevisionIds: [], acceptanceCriterionIds: ["not-a-uuid"],
    },
  }, service), (error) => error.code === "INVALID_PAYLOAD" && error.status === 400);

  const unmatched = await dispatchPhase2Request({ method: "POST", url: `/api/workbench/features/${featureId}/release-assignment`, headers: {}, body: {} }, service);
  assert.equal(unmatched, null);
});
