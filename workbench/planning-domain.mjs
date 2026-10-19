import { createHash } from "node:crypto";
import { WorkbenchError } from "./domain.mjs";

export const PLANNING_PROVENANCE = "manual";
export const VALIDATOR_SET_VERSION = "planning-deterministic-v1";

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

export function canonicalHash(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function byId(left, right) {
  return left.id.localeCompare(right.id);
}

function collectionDifferences(collection, beforeItems, afterItems) {
  const before = new Map(beforeItems.map((item) => [item.id, item]));
  const after = new Map(afterItems.map((item) => [item.id, item]));
  const differences = [];
  for (const id of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const previous = before.get(id);
    const current = after.get(id);
    if (!previous) {
      differences.push({ collection, entityId: id, change: "added", fields: [{ field: "$item", before: null, after: canonicalValue(current) }] });
      continue;
    }
    if (!current) {
      differences.push({ collection, entityId: id, change: "removed", fields: [{ field: "$item", before: canonicalValue(previous), after: null }] });
      continue;
    }
    const fields = [...new Set([...Object.keys(previous), ...Object.keys(current)])]
      .filter((field) => field !== "id")
      .sort()
      .filter((field) => canonicalJson(previous[field]) !== canonicalJson(current[field]))
      .map((field) => ({ field, before: canonicalValue(previous[field]), after: canonicalValue(current[field]) }));
    if (fields.length > 0) differences.push({ collection, entityId: id, change: "changed", fields });
  }
  return differences;
}

export function compareScenarioRevisions(before, after) {
  if (before.productId !== after.productId) throw new WorkbenchError("Scenario revisions from different Products cannot be compared.", 409, "PRODUCT_SCOPE_MISMATCH");
  const fields = ["deliveryId", "provenance"]
    .filter((field) => canonicalJson(before[field]) !== canonicalJson(after[field]))
    .map((field) => ({ field, before: canonicalValue(before[field]), after: canonicalValue(after[field]) }));
  const collections = [
    ...collectionDifferences("activities", before.activities, after.activities),
    ...collectionDifferences("deliverables", before.deliverables, after.deliverables),
    ...collectionDifferences("constraints", before.constraints, after.constraints),
  ];
  return {
    productId: before.productId,
    beforeRevisionId: before.id,
    afterRevisionId: after.id,
    beforeInputHash: before.inputHash,
    afterInputHash: after.inputHash,
    equal: fields.length === 0 && collections.length === 0,
    fields,
    collections,
  };
}

export function assertScenarioPolicy(constraints, policy) {
  for (const constraint of constraints) {
    if (!constraint.override) continue;
    if (constraint.level !== "advisory") throw new WorkbenchError("Only advisory constraints can be explicitly overridden.", 400, "INVALID_POLICY_OVERRIDE");
    if (!constraint.overrideRationale?.trim()) throw new WorkbenchError("An advisory constraint override requires a rationale.", 400, "ADVISORY_OVERRIDE_RATIONALE_REQUIRED");
  }
  if (!policy) return;
  for (const rule of policy.rules.filter((item) => item.level === "mandatory")) {
    const constraint = constraints.find((item) => item.id === rule.id);
    if (!constraint) throw new WorkbenchError(`Mandatory Planning Policy rule ${rule.id} must be present in the Scenario revision.`, 409, "MANDATORY_POLICY_RULE_MISSING");
    if (constraint.level !== rule.level || constraint.kind !== rule.kind || constraint.ruleVersion !== rule.ruleVersion || constraint.override) {
      throw new WorkbenchError(`Mandatory Planning Policy rule ${rule.id} cannot be altered or overridden.`, 409, "MANDATORY_POLICY_RULE_ALTERED");
    }
  }
}

export function compileSchedulingModel(revision, catalog) {
  const model = {
    productId: revision.productId,
    deliveryId: revision.deliveryId,
    scenarioId: revision.scenarioId,
    revisionId: revision.id,
    revisionNumber: revision.revisionNumber,
    provenance: revision.provenance,
    policy: catalog.policy ? canonicalValue(catalog.policy) : null,
    resources: [...catalog.resources].sort(byId).map(canonicalValue),
    trains: [...catalog.trains].sort(byId).map(canonicalValue),
    activities: [...revision.activities].sort(byId).map((item) => ({ ...canonicalValue(item), predecessorIds: [...item.predecessorIds].sort(), demands: [...item.demands].sort((a, b) => `${a.resourceId}:${a.units}`.localeCompare(`${b.resourceId}:${b.units}`)) })),
    deliverables: [...revision.deliverables].sort(byId).map((item) => ({ ...canonicalValue(item), predecessorIds: [...item.predecessorIds].sort() })),
    constraints: [...revision.constraints].sort(byId).map(canonicalValue),
    actuals: [...(catalog.actuals ?? [])].sort((a, b) => `${a.observedAt}:${a.id}`.localeCompare(`${b.observedAt}:${b.id}`)).map(canonicalValue),
  };
  return { ...model, inputHash: canonicalHash(model) };
}

function finding(status, code, message, entityType, entityId = null, details = {}) {
  return { id: canonicalHash({ status, code, entityType, entityId, details }).slice(0, 24), status, code, message, entityType, entityId, details };
}

function cyclePath(activities) {
  const values = new Map(activities.map((item) => [item.id, item]));
  const visiting = new Set();
  const visited = new Set();
  const stack = [];
  const visit = (id) => {
    if (visiting.has(id)) return [...stack.slice(stack.indexOf(id)), id];
    if (visited.has(id)) return null;
    visiting.add(id);
    stack.push(id);
    for (const predecessorId of values.get(id)?.predecessorIds ?? []) {
      const cycle = visit(predecessorId);
      if (cycle) return cycle;
    }
    stack.pop();
    visiting.delete(id);
    visited.add(id);
    return null;
  };
  for (const item of activities) {
    const cycle = visit(item.id);
    if (cycle) return cycle;
  }
  return null;
}

function capacityAt(resource, instant) {
  const entries = resource.capacity.filter((item) => item.effectiveFrom <= instant && (!item.effectiveTo || instant < item.effectiveTo));
  return entries.sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0]?.units;
}

function validateCapacity(model, findings) {
  for (const resource of model.resources) {
    const demands = model.activities.flatMap((activity) => activity.demands.filter((item) => item.resourceId === resource.id).map((item) => ({ activityId: activity.id, startAt: activity.startAt, endAt: activity.endAt, units: item.units })));
    const points = new Set(demands.map((item) => item.startAt));
    for (const capacity of resource.capacity) {
      if (demands.some((item) => item.startAt <= capacity.effectiveFrom && capacity.effectiveFrom < item.endAt)) points.add(capacity.effectiveFrom);
      if (capacity.effectiveTo && demands.some((item) => item.startAt <= capacity.effectiveTo && capacity.effectiveTo < item.endAt)) points.add(capacity.effectiveTo);
    }
    for (const at of [...points].sort()) {
      const used = demands.filter((item) => item.startAt <= at && at < item.endAt).reduce((total, item) => total + item.units, 0);
      if (used === 0) continue;
      const capacity = capacityAt(resource, at);
      if (capacity === undefined) findings.push(finding("unknown", "RESOURCE_CAPACITY_UNKNOWN", `Resource ${resource.name} has no capacity covering ${at}.`, "Resource", resource.id, { at }));
      else if (used > capacity) findings.push(finding("violated", "RESOURCE_CAPACITY_EXCEEDED", `Resource ${resource.name} demand ${used} exceeds integer capacity ${capacity}.`, "Resource", resource.id, { at, demand: used, capacity }));
    }
  }
}

export function validateScenario(model, { asOf, validatorSetVersion = VALIDATOR_SET_VERSION } = {}) {
  if (!asOf || Number.isNaN(Date.parse(asOf))) throw new WorkbenchError("An explicit valid asOf instant is required.", 400, "AS_OF_REQUIRED");
  const findings = [];
  const resourceIds = new Set(model.resources.map((item) => item.id));
  const trainIds = new Set(model.trains.map((item) => item.id));
  const activityIds = new Set(model.activities.map((item) => item.id));
  const deliverableIds = new Set(model.deliverables.map((item) => item.id));

  if (model.activities.length === 0) findings.push(finding("unknown", "ACTIVITY_PLAN_UNKNOWN", "The Scenario revision has no explicit Activities.", "ScenarioRevision", model.revisionId));
  if (model.deliverables.length === 0) findings.push(finding("unknown", "DELIVERABLE_PLAN_UNKNOWN", "The Scenario revision has no explicit Deliverables.", "ScenarioRevision", model.revisionId));
  if (model.provenance !== PLANNING_PROVENANCE) findings.push(finding("violated", "INVALID_PROVENANCE", "A manually managed Scenario must retain manual provenance.", "Scenario", model.scenarioId));
  for (const item of model.activities) {
    if (item.productId !== model.productId) findings.push(finding("violated", "PRODUCT_SCOPE_MISMATCH", "The Activity must belong to the Scenario Product.", "Activity", item.id));
    if (!(item.startAt < item.endAt)) findings.push(finding("violated", "ACTIVITY_WINDOW_INVALID", "The Activity end must be after its start.", "Activity", item.id));
    for (const id of item.predecessorIds) {
      const predecessor = model.activities.find((candidate) => candidate.id === id);
      if (!activityIds.has(id)) findings.push(finding("violated", "PREDECESSOR_MISSING", "The Activity references a missing predecessor.", "Activity", item.id, { predecessorId: id }));
      else if (predecessor.endAt > item.startAt) findings.push(finding("violated", "PREDECESSOR_TIMING", "The successor begins before its predecessor completes.", "Activity", item.id, { predecessorId: id, predecessorEndAt: predecessor.endAt, successorStartAt: item.startAt }));
    }
    for (const demand of item.demands) if (!resourceIds.has(demand.resourceId)) findings.push(finding("unknown", "RESOURCE_REFERENCE_UNKNOWN", "The Activity demand references a missing or out-of-scope Resource.", "Activity", item.id, { resourceId: demand.resourceId }));
    if (item.demands.length === 0) findings.push(finding("unknown", "RESOURCE_DEMAND_UNKNOWN", "The Activity has no explicit Resource demand.", "Activity", item.id));
  }
  const cycle = cyclePath(model.activities);
  if (cycle) findings.push(finding("violated", "DEPENDENCY_CYCLE", `Activity dependencies contain a cycle: ${cycle.join(" → ")}.`, "ScenarioRevision", model.revisionId, { path: cycle }));
  validateCapacity(model, findings);

  for (const item of model.deliverables) {
    if (item.productId !== model.productId) findings.push(finding("violated", "PRODUCT_SCOPE_MISMATCH", "The Deliverable must belong to the Scenario Product.", "Deliverable", item.id));
    if (!item.trainId) findings.push(finding("unknown", "TRAIN_ASSIGNMENT_UNKNOWN", "The Deliverable has no explicit Train assignment.", "Deliverable", item.id));
    else if (!trainIds.has(item.trainId)) findings.push(finding("unknown", "TRAIN_REFERENCE_UNKNOWN", "The Deliverable references a missing or out-of-scope Train.", "Deliverable", item.id));
    else {
      const train = model.trains.find((candidate) => candidate.id === item.trainId);
      if (!train.cutoffAt) findings.push(finding("unknown", "TRAIN_CUTOFF_UNKNOWN", "The assigned Train has no cutoff.", "Train", train.id));
      else if (!item.readyAt) findings.push(finding("unknown", "DELIVERABLE_READINESS_UNKNOWN", "The Deliverable has no explicit readiness instant.", "Deliverable", item.id));
      else if (item.readyAt > train.cutoffAt) findings.push(finding("violated", "TRAIN_CUTOFF_MISSED", "The Deliverable is ready after its Train cutoff.", "Deliverable", item.id, { readyAt: item.readyAt, cutoffAt: train.cutoffAt }));
    }
    for (const id of item.predecessorIds) {
      const predecessor = model.deliverables.find((candidate) => candidate.id === id);
      if (!deliverableIds.has(id)) findings.push(finding("violated", "DELIVERABLE_PREDECESSOR_MISSING", "The Deliverable references a missing predecessor.", "Deliverable", item.id, { predecessorId: id }));
      else if (predecessor.order >= item.order) findings.push(finding("violated", "DELIVERABLE_ORDER_INVALID", "A predecessor Deliverable must have a lower explicit order.", "Deliverable", item.id, { predecessorId: id }));
    }
  }

  for (const constraint of model.constraints) {
    if (!["mandatory", "configurable", "advisory"].includes(constraint.level)) findings.push(finding("violated", "CONSTRAINT_LEVEL_INVALID", "The constraint level is unsupported.", "Constraint", constraint.id));
    if (!["activity-window", "resource-capacity", "train-cutoff", "deliverable-order"].includes(constraint.kind)) findings.push(finding("unknown", "CONSTRAINT_UNSUPPORTED", `Constraint kind ${constraint.kind} is not supported by this validator set.`, "Constraint", constraint.id));
    if (constraint.requiresEvidence && !constraint.evidence) findings.push(finding("unknown", "CONSTRAINT_EVIDENCE_UNKNOWN", "Required constraint evidence is missing.", "Constraint", constraint.id));
    if (constraint.override && constraint.level !== "advisory") findings.push(finding("violated", "INVALID_POLICY_OVERRIDE", "Only advisory constraints can be explicitly overridden.", "Constraint", constraint.id));
    if (constraint.override && !constraint.overrideRationale?.trim()) findings.push(finding("unknown", "ADVISORY_OVERRIDE_RATIONALE_UNKNOWN", "The advisory constraint override has no rationale.", "Constraint", constraint.id));
  }
  if (!model.policy) findings.push(finding("unknown", "POLICY_UNKNOWN", "No Planning Policy revision was supplied.", "ScenarioRevision", model.revisionId));
  else {
    if (model.policy.rules.length === 0) findings.push(finding("unknown", "POLICY_RULES_UNKNOWN", "The Planning Policy revision has no explicit rules.", "PlanningPolicyRevision", model.policy.id));
    if (model.policy.productId !== model.productId) findings.push(finding("violated", "PRODUCT_SCOPE_MISMATCH", "The Planning Policy must belong to the Scenario Product.", "PlanningPolicyRevision", model.policy.id));
    for (const rule of model.policy.rules) {
      if (!["mandatory", "configurable", "advisory"].includes(rule.level)) findings.push(finding("unknown", "POLICY_LEVEL_UNKNOWN", "The Planning Policy rule has an unsupported level.", "PlanningPolicyRule", rule.id, { level: rule.level }));
      if (!["activity-window", "resource-capacity", "train-cutoff", "deliverable-order"].includes(rule.kind)) findings.push(finding("unknown", "POLICY_RULE_UNSUPPORTED", `Planning Policy rule kind ${rule.kind} is not supported by this validator set.`, "PlanningPolicyRule", rule.id, { level: rule.level, ruleVersion: rule.ruleVersion }));
      const constraint = model.constraints.find((item) => item.id === rule.id);
      if (!constraint) findings.push(finding(rule.level === "mandatory" ? "violated" : "unknown", rule.level === "mandatory" ? "MANDATORY_POLICY_RULE_MISSING" : "POLICY_RULE_NOT_IN_SCENARIO", "The Scenario does not declare the Planning Policy rule.", "PlanningPolicyRule", rule.id, { level: rule.level, kind: rule.kind, ruleVersion: rule.ruleVersion }));
      else if (constraint.level !== rule.level || constraint.kind !== rule.kind || constraint.ruleVersion !== rule.ruleVersion || (rule.level === "mandatory" && constraint.override)) findings.push(finding(rule.level === "mandatory" ? "violated" : "unknown", rule.level === "mandatory" ? "MANDATORY_POLICY_RULE_ALTERED" : "POLICY_RULE_ALTERED", "The Scenario altered the Planning Policy rule definition.", "PlanningPolicyRule", rule.id, { level: rule.level, kind: rule.kind, ruleVersion: rule.ruleVersion }));
    }
  }
  const sorted = findings.sort((a, b) => `${a.code}:${a.entityId ?? ''}:${a.id}`.localeCompare(`${b.code}:${b.entityId ?? ''}:${b.id}`));
  const mandatoryBlocked = sorted.some((item) => item.status === "violated" || item.status === "unknown");
  return { asOf, validatorSetVersion, inputHash: model.inputHash, status: mandatoryBlocked ? "blocked" : "verified", findings: sorted };
}
