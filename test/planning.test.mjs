import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { canonicalHash, compareScenarioRevisions, compileSchedulingModel, validateScenario } from "../workbench/planning-domain.mjs";
import { handlePlanningHttp } from "../workbench/planning-api.mjs";
import { MemoryPlanningRepository } from "../workbench/planning-memory-repository.mjs";
import { PlanningService } from "../workbench/planning-service.mjs";

const productId = randomUUID();
const iso = (day) => `2026-04-${String(day).padStart(2, "0")}T00:00:00.000Z`;

function serviceFixture() {
  const repository = new MemoryPlanningRepository({ product: { id: productId, name: "Workbench", version: 1 } });
  return { repository, service: new PlanningService(repository) };
}

test("canonical planning hashes do not depend on object key order", () => {
  assert.equal(canonicalHash({ b: 2, a: { d: 4, c: 3 } }), canonicalHash({ a: { c: 3, d: 4 }, b: 2 }));
});

test("manual scenario revisions are isolated clones and actuals are append-only idempotent events", async () => {
  const { repository, service } = serviceFixture();
  let workspace = (await service.saveDelivery("delivery-1", productId, null, { expectedProductVersion: 1, name: "Delivery A" })).body;
  const deliveryId = workspace.deliveries[0].id;
  workspace = (await service.createScenario("scenario-1", productId, { expectedProductVersion: 2, deliveryId, name: "Baseline" })).body;
  const sourceId = workspace.scenarios[0].id;
  const activityId = randomUUID();
  const revisionInput = {
    expectedScenarioVersion: 1,
    activities: [{ id: activityId, name: "Build", startAt: iso(1), endAt: iso(2), predecessorIds: [], demands: [] }],
    deliverables: [{ id: randomUUID(), name: "Package", order: 0, predecessorIds: [], trainId: null, readyAt: null }],
    constraints: [],
  };
  workspace = (await service.createRevision("revision-1", productId, sourceId, revisionInput)).body;
  const sourceRevision = workspace.scenarios[0].revisions[0];
  revisionInput.activities[0].name = "Mutated caller value";
  workspace = (await service.cloneScenario("clone-1", productId, sourceId, { expectedProductVersion: 3, revisionId: sourceRevision.id, name: "Alternative" })).body;
  const clone = workspace.scenarios.find((item) => item.id !== sourceId);
  assert.equal(clone.provenance, "manual");
  assert.equal(clone.revisions[0].activities[0].name, "Build");
  assert.notEqual(clone.revisions[0].id, sourceRevision.id);
  assert.equal(clone.revisions[0].inputHash, sourceRevision.inputHash);

  const actualInput = { activityId, kind: "completed", value: { percent: 100 }, observedAt: iso(2) };
  const first = await service.appendActual("actual-1", productId, sourceId, actualInput);
  const replay = await service.appendActual("actual-1", productId, sourceId, actualInput);
  assert.equal(replay.replayed, true);
  assert.equal(replay.body.id, first.body.id);
  assert.equal((await repository.getWorkspace(productId)).actuals.length, 1);
  await assert.rejects(() => service.appendActual("actual-1", productId, sourceId, { ...actualInput, kind: "started" }), (error) => error.code === "IDEMPOTENCY_KEY_REUSED");
});

test("deterministic validation blocks unknown capacity, policy, assignment, and evidence rather than claiming success", () => {
  const resourceId = randomUUID();
  const revision = {
    id: randomUUID(), scenarioId: randomUUID(), deliveryId: randomUUID(), productId, revisionNumber: 1, provenance: "manual",
    activities: [{ id: randomUUID(), productId, name: "Build", startAt: iso(1), endAt: iso(2), predecessorIds: [], demands: [{ resourceId, units: 1 }] }],
    deliverables: [{ id: randomUUID(), productId, name: "Package", order: 0, predecessorIds: [], trainId: null, readyAt: null }],
    constraints: [{ id: randomUUID(), level: "mandatory", kind: "activity-window", ruleVersion: "v1", requiresEvidence: true, evidence: null }],
  };
  const model = compileSchedulingModel(revision, { policy: null, resources: [{ id: resourceId, productId, name: "Team", capacity: [] }], trains: [], actuals: [] });
  const first = validateScenario(model, { asOf: iso(3) });
  const second = validateScenario(model, { asOf: iso(3) });
  assert.deepEqual(second, first);
  assert.equal(first.status, "blocked");
  const codes = first.findings.map((item) => item.code);
  assert.ok(codes.includes("RESOURCE_CAPACITY_UNKNOWN"));
  assert.ok(codes.includes("POLICY_UNKNOWN"));
  assert.ok(codes.includes("TRAIN_ASSIGNMENT_UNKNOWN"));
  assert.ok(codes.includes("CONSTRAINT_EVIDENCE_UNKNOWN"));
  assert.ok(first.findings.every((item) => item.status !== "verified"));
});

test("capacity validation observes dated capacity changes inside an Activity window", () => {
  const resourceId = randomUUID();
  const revision = {
    id: randomUUID(), scenarioId: randomUUID(), deliveryId: randomUUID(), productId, revisionNumber: 1, provenance: "manual",
    activities: [{ id: randomUUID(), productId, name: "Build", startAt: iso(1), endAt: iso(4), predecessorIds: [], demands: [{ resourceId, units: 2 }] }],
    deliverables: [{ id: randomUUID(), productId, name: "Package", order: 0, predecessorIds: [], trainId: null, readyAt: null }],
    constraints: [],
  };
  const resources = [{ id: resourceId, productId, name: "Team", capacity: [{ effectiveFrom: iso(1), effectiveTo: iso(2), units: 2 }, { effectiveFrom: iso(2), effectiveTo: null, units: 1 }] }];
  const validation = validateScenario(compileSchedulingModel(revision, { policy: null, resources, trains: [], actuals: [] }), { asOf: iso(4) });
  assert.ok(validation.findings.some((item) => item.code === "RESOURCE_CAPACITY_EXCEEDED" && item.details.at === iso(2)));
});

test("planning writes enforce optimistic Product concurrency", async () => {
  const { service } = serviceFixture();
  await service.saveDelivery("delivery-version", productId, null, { expectedProductVersion: 1, name: "Delivery" });
  await assert.rejects(
    () => service.saveResource("resource-stale", productId, null, { expectedProductVersion: 1, name: "Team", capacity: [] }),
    (error) => error.code === "STALE_VERSION",
  );
});

test("Scenario revision comparison reports deterministic field and collection differences", () => {
  const activityId = randomUUID();
  const base = { id: randomUUID(), productId, deliveryId: randomUUID(), provenance: "manual", inputHash: "a".repeat(64), activities: [{ id: activityId, name: "Build", predecessorIds: [], demands: [] }], deliverables: [], constraints: [] };
  const target = { ...structuredClone(base), id: randomUUID(), inputHash: "b".repeat(64), activities: [{ id: activityId, name: "Build and test", predecessorIds: [], demands: [] }], deliverables: [{ id: randomUUID(), name: "Package", order: 0 }] };
  const comparison = compareScenarioRevisions(base, target);
  assert.equal(comparison.equal, false);
  assert.deepEqual(comparison.fields, []);
  assert.deepEqual(comparison.collections.map((item) => [item.collection, item.change]), [["activities", "changed"], ["deliverables", "added"]]);
  assert.deepEqual(comparison.collections[0].fields, [{ field: "name", before: "Build", after: "Build and test" }]);
  assert.throws(() => compareScenarioRevisions(base, { ...target, productId: randomUUID() }), (error) => error.code === "PRODUCT_SCOPE_MISMATCH");
});

test("comparison service and HTTP route reject revisions outside the requested Product", async () => {
  const beforeId = randomUUID();
  const afterId = randomUUID();
  const otherProductId = randomUUID();
  const revision = (id, scopedProductId) => ({ id, productId: scopedProductId, deliveryId: randomUUID(), provenance: "manual", inputHash: "a".repeat(64), activities: [], deliverables: [], constraints: [] });
  const service = new PlanningService({ getScenarioRevisions: async () => [revision(beforeId, productId), revision(afterId, otherProductId)] });
  await assert.rejects(() => service.compareRevisions(productId, beforeId, afterId), (error) => error.code === "PRODUCT_SCOPE_MISMATCH");

  let responseStatus;
  let responseBody;
  const routeService = { compareRevisions: async () => ({ equal: true }) };
  const handled = await handlePlanningHttp(
    { method: "GET", url: `/api/workbench/products/${productId}/planning/revisions/${beforeId}/comparisons/${afterId}`, headers: {} },
    {},
    routeService,
    async () => undefined,
    (_response, status, body) => { responseStatus = status; responseBody = body; },
  );
  assert.equal(handled, true);
  assert.equal(responseStatus, 200);
  assert.deepEqual(responseBody, { equal: true });
});

test("mandatory policy rules cannot be omitted or altered and unsupported mandatory rules stay blocked", async () => {
  const { service } = serviceFixture();
  const ruleId = randomUUID();
  let workspace = (await service.savePolicy("policy-command", productId, { expectedProductVersion: 1, rules: [{ id: ruleId, level: "mandatory", kind: "external-gate", ruleVersion: "v1", parameters: {} }] })).body;
  workspace = (await service.saveDelivery("delivery-command", productId, null, { expectedProductVersion: 2, name: "Delivery" })).body;
  const deliveryId = workspace.deliveries[0].id;
  workspace = (await service.createScenario("scenario-command", productId, { expectedProductVersion: 3, deliveryId, name: "Baseline" })).body;
  const scenarioId = workspace.scenarios[0].id;
  const base = { expectedScenarioVersion: 1, activities: [], deliverables: [], constraints: [] };
  await assert.rejects(() => service.createRevision("missing-rule", productId, scenarioId, base), (error) => error.code === "MANDATORY_POLICY_RULE_MISSING");
  await assert.rejects(() => service.createRevision("altered-rule", productId, scenarioId, { ...base, constraints: [{ id: ruleId, level: "mandatory", kind: "external-gate", ruleVersion: "v2" }] }), (error) => error.code === "MANDATORY_POLICY_RULE_ALTERED");
  workspace = (await service.createRevision("protected-rule", productId, scenarioId, { ...base, constraints: [{ id: ruleId, level: "mandatory", kind: "external-gate", ruleVersion: "v1" }] })).body;
  const revisionId = workspace.scenarios[0].revisions[0].id;
  const validation = (await service.validateRevision("validate-rule", productId, revisionId, { asOf: iso(3), validatorSetVersion: "test-v1" })).body;
  assert.equal(validation.status, "blocked");
  assert.ok(validation.findings.some((item) => item.code === "POLICY_RULE_UNSUPPORTED" && item.status === "unknown"));
});

test("an explicit advisory override requires a rationale", async () => {
  const { service } = serviceFixture();
  let workspace = (await service.saveDelivery("advisory-delivery", productId, null, { expectedProductVersion: 1, name: "Delivery" })).body;
  workspace = (await service.createScenario("advisory-scenario", productId, { expectedProductVersion: 2, deliveryId: workspace.deliveries[0].id, name: "Baseline" })).body;
  const scenarioId = workspace.scenarios[0].id;
  const constraint = { id: randomUUID(), level: "advisory", kind: "activity-window", ruleVersion: "v1", override: true };
  const input = { expectedScenarioVersion: 1, activities: [], deliverables: [], constraints: [constraint] };
  await assert.rejects(() => service.createRevision("advisory-missing-rationale", productId, scenarioId, input), (error) => error.code === "ADVISORY_OVERRIDE_RATIONALE_REQUIRED");
  const result = await service.createRevision("advisory-with-rationale", productId, scenarioId, { ...input, constraints: [{ ...constraint, overrideRationale: "The Product owner accepted the scheduling exception for this revision." }] });
  assert.equal(result.status, 201);
  assert.equal(result.body.scenarios[0].revisions[0].constraints[0].overrideRationale, "The Product owner accepted the scheduling exception for this revision.");
});
