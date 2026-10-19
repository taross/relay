import { WorkbenchError } from "./domain.mjs";
import { hashCommand } from "./service.mjs";
import { assertScenarioPolicy, canonicalHash, compareScenarioRevisions, compileSchedulingModel, validateScenario } from "./planning-domain.mjs";

const required = (value, label) => { if (typeof value !== "string") throw new WorkbenchError(`${label} is required.`, 400, "INVALID_PAYLOAD"); const result = value.trim(); if (!result) throw new WorkbenchError(`${label} is required.`, 400, "INVALID_PAYLOAD"); return result; };
const array = (value, label) => { if (!Array.isArray(value)) throw new WorkbenchError(`${label} must be an array.`, 400, "INVALID_PAYLOAD"); return value; };
const unique = (values, label) => [...new Set(array(values, label))];
const positiveInteger = (value, label) => { if (!Number.isInteger(value) || value < 1) throw new WorkbenchError(`${label} must be a positive integer.`, 400, "INVALID_PAYLOAD"); return value; };
const assertUniqueIds = (values, label) => { if (new Set(values.map((item) => item.id)).size !== values.length) throw new WorkbenchError(`${label} ids must be unique.`, 400, "INVALID_PAYLOAD"); return values; };

function instant(value, label, nullable = false) {
  if (nullable && (value === null || value === undefined || value === "")) return null;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) throw new WorkbenchError(`${label} must be a valid ISO instant.`, 400, "INVALID_PAYLOAD");
  return new Date(value).toISOString();
}

function revisionValues(input, productId) {
  const activities = array(input.activities, "activities").map((item) => ({ id: required(item.id, "Activity id"), productId, name: required(item.name, "Activity name"), startAt: instant(item.startAt, "startAt"), endAt: instant(item.endAt, "endAt"), predecessorIds: unique(item.predecessorIds, "predecessorIds"), demands: array(item.demands, "demands").map((demand) => {
    if (!Number.isInteger(demand.units) || demand.units < 1) throw new WorkbenchError("Resource demand units must be a positive integer.", 400, "INVALID_PAYLOAD");
    return { resourceId: demand.resourceId, units: demand.units };
  }) }));
  const deliverables = array(input.deliverables, "deliverables").map((item) => {
    if (!Number.isInteger(item.order) || item.order < 0) throw new WorkbenchError("Deliverable order must be a non-negative integer.", 400, "INVALID_PAYLOAD");
    return { id: required(item.id, "Deliverable id"), productId, name: required(item.name, "Deliverable name"), order: item.order, predecessorIds: unique(item.predecessorIds, "predecessorIds"), trainId: item.trainId ?? null, readyAt: instant(item.readyAt, "readyAt", true) };
  });
  const constraints = array(input.constraints, "constraints").map((item) => {
    if (item.override !== undefined && typeof item.override !== "boolean") throw new WorkbenchError("Constraint override must be a boolean.", 400, "INVALID_PAYLOAD");
    if (item.overrideRationale !== undefined && item.overrideRationale !== null && typeof item.overrideRationale !== "string") throw new WorkbenchError("Constraint overrideRationale must be a string.", 400, "INVALID_PAYLOAD");
    return { id: required(item.id, "Constraint id"), level: item.level, kind: required(item.kind, "Constraint kind"), ruleVersion: required(item.ruleVersion, "Constraint ruleVersion"), requiresEvidence: Boolean(item.requiresEvidence), evidence: item.evidence ?? null, override: item.override ?? false, overrideRationale: item.overrideRationale?.trim() || null };
  });
  return { activities: assertUniqueIds(activities, "Activity"), deliverables: assertUniqueIds(deliverables, "Deliverable"), constraints: assertUniqueIds(constraints, "Constraint") };
}

export class PlanningService {
  constructor(repository) { this.repository = repository; }
  getWorkspace(productId) { return this.repository.getWorkspace(productId); }
  async compareRevisions(productId, beforeRevisionId, afterRevisionId) {
    const revisions = await this.repository.getScenarioRevisions([...new Set([beforeRevisionId, afterRevisionId])]);
    const before = revisions.find((revision) => revision.id === beforeRevisionId);
    const after = revisions.find((revision) => revision.id === afterRevisionId);
    if (!before || !after) throw new WorkbenchError("Scenario revision was not found.", 404, "NOT_FOUND");
    if (before.productId !== productId || after.productId !== productId) throw new WorkbenchError("Scenario revisions from different Products cannot be compared.", 409, "PRODUCT_SCOPE_MISMATCH");
    return compareScenarioRevisions(before, after);
  }
  #run(commandId, operation, payload, task) { return this.repository.runCommand(required(commandId, "Idempotency-Key header"), operation, hashCommand(operation, payload), task); }

  savePolicy(commandId, productId, input) {
    return this.#run(commandId, "create-planning-policy-revision", { productId, ...input }, async (tx) => {
      await tx.lockProduct(productId);
      const rules = array(input.rules, "rules").map((item) => ({ id: required(item.id, "Rule id"), level: item.level, kind: required(item.kind, "Rule kind"), ruleVersion: required(item.ruleVersion, "Rule version"), parameters: item.parameters ?? {} }));
      if (rules.some((item) => !["mandatory", "configurable", "advisory"].includes(item.level))) throw new WorkbenchError("Rule level must be mandatory, configurable, or advisory.", 400, "INVALID_PAYLOAD");
      assertUniqueIds(rules, "Rule");
      const result = await tx.savePolicy({ productId, expectedProductVersion: positiveInteger(input.expectedProductVersion, "expectedProductVersion"), rules });
      return { status: 201, body: result.workspace };
    });
  }

  saveResource(commandId, productId, resourceId, input) {
    return this.#run(commandId, resourceId ? "update-planning-resource" : "create-planning-resource", { productId, resourceId, ...input }, async (tx) => {
      await tx.lockProduct(productId);
      const capacity = array(input.capacity, "capacity").map((item) => {
        if (!Number.isInteger(item.units) || item.units < 0) throw new WorkbenchError("Capacity units must be a non-negative integer.", 400, "INVALID_PAYLOAD");
        const effectiveFrom = instant(item.effectiveFrom, "effectiveFrom");
        const effectiveTo = instant(item.effectiveTo, "effectiveTo", true);
        if (effectiveTo && effectiveTo <= effectiveFrom) throw new WorkbenchError("Capacity effectiveTo must be after effectiveFrom.", 400, "INVALID_PAYLOAD");
        return { effectiveFrom, effectiveTo, units: item.units };
      }).sort((left, right) => left.effectiveFrom.localeCompare(right.effectiveFrom));
      for (let index = 1; index < capacity.length; index += 1) {
        const previous = capacity[index - 1];
        if (!previous.effectiveTo || previous.effectiveTo > capacity[index].effectiveFrom) throw new WorkbenchError("Capacity periods must not overlap.", 400, "INVALID_PAYLOAD");
      }
      const result = await tx.saveResource({ id: resourceId, productId, expectedProductVersion: positiveInteger(input.expectedProductVersion, "expectedProductVersion"), expectedVersion: resourceId ? positiveInteger(input.expectedVersion, "expectedVersion") : null, name: required(input.name, "Resource name"), capacity });
      return { status: result.created ? 201 : 200, body: result.workspace };
    });
  }

  saveDelivery(commandId, productId, deliveryId, input) {
    return this.#run(commandId, deliveryId ? "update-planning-delivery" : "create-planning-delivery", { productId, deliveryId, ...input }, async (tx) => {
      await tx.lockProduct(productId);
      const result = await tx.saveDelivery({ id: deliveryId, productId, expectedProductVersion: positiveInteger(input.expectedProductVersion, "expectedProductVersion"), expectedVersion: deliveryId ? positiveInteger(input.expectedVersion, "expectedVersion") : null, name: required(input.name, "Delivery name") });
      return { status: result.created ? 201 : 200, body: result.workspace };
    });
  }

  saveTrain(commandId, productId, trainId, input) {
    return this.#run(commandId, trainId ? "update-planning-train" : "create-planning-train", { productId, trainId, ...input }, async (tx) => {
      await tx.lockProduct(productId);
      const result = await tx.saveTrain({ id: trainId, productId, expectedProductVersion: positiveInteger(input.expectedProductVersion, "expectedProductVersion"), expectedVersion: trainId ? positiveInteger(input.expectedVersion, "expectedVersion") : null, name: required(input.name, "Train name"), cutoffAt: instant(input.cutoffAt, "cutoffAt", true) });
      return { status: result.created ? 201 : 200, body: result.workspace };
    });
  }

  createScenario(commandId, productId, input) {
    return this.#run(commandId, "create-manual-scenario", { productId, ...input }, async (tx) => {
      await tx.lockProduct(productId);
      const workspace = await tx.readWorkspace(productId);
      if (!workspace.deliveries.some((item) => item.id === input.deliveryId && item.productId === productId)) throw new WorkbenchError("Delivery was not found for this Product.", 409, "INVALID_REFERENCE");
      const result = await tx.createScenario({ productId, deliveryId: input.deliveryId, name: required(input.name, "Scenario name"), expectedProductVersion: positiveInteger(input.expectedProductVersion, "expectedProductVersion") });
      return { status: 201, body: result.workspace };
    });
  }

  createRevision(commandId, productId, scenarioId, input) {
    return this.#run(commandId, "create-manual-scenario-revision", { productId, scenarioId, ...input }, async (tx) => {
      await tx.lockProduct(productId);
      const values = revisionValues(input, productId);
      const workspace = await tx.readWorkspace(productId);
      assertScenarioPolicy(values.constraints, workspace.policies.at(-1) ?? null);
      const inputHash = canonicalHash({ productId, ...values });
      const result = await tx.createRevision({ productId, scenarioId, expectedScenarioVersion: positiveInteger(input.expectedScenarioVersion, "expectedScenarioVersion"), inputHash, ...values });
      return { status: 201, body: result.workspace };
    });
  }

  cloneScenario(commandId, productId, scenarioId, input) {
    return this.#run(commandId, "clone-manual-scenario", { productId, scenarioId, ...input }, async (tx) => {
      await tx.lockProduct(productId);
      const workspace = await tx.readWorkspace(productId);
      const source = workspace.scenarios.find((scenario) => scenario.id === scenarioId)?.revisions.find((revision) => revision.id === input.revisionId);
      if (!source) throw new WorkbenchError("Scenario revision was not found.", 404, "NOT_FOUND");
      assertScenarioPolicy(source.constraints, workspace.policies.at(-1) ?? null);
      const result = await tx.cloneScenario({ productId, scenarioId, revisionId: input.revisionId, expectedProductVersion: positiveInteger(input.expectedProductVersion, "expectedProductVersion"), name: required(input.name, "Scenario name") });
      return { status: 201, body: result.workspace };
    });
  }

  appendActual(commandId, productId, scenarioId, input) {
    return this.#run(commandId, "append-planning-actual", { productId, scenarioId, ...input }, async (tx) => {
      await tx.lockProduct(productId);
      const workspace = await tx.readWorkspace(productId);
      const scenario = workspace.scenarios.find((item) => item.id === scenarioId && item.productId === productId);
      if (!scenario) throw new WorkbenchError("Scenario was not found.", 404, "NOT_FOUND");
      if (!scenario.revisions.some((revision) => revision.activities.some((activity) => activity.id === input.activityId))) throw new WorkbenchError("Activity was not found in this Scenario.", 409, "INVALID_REFERENCE");
      const result = await tx.appendActual({ productId, scenarioId, activityId: input.activityId, kind: required(input.kind, "Actual kind"), value: input.value, observedAt: instant(input.observedAt, "observedAt") });
      return { status: 201, body: result.actual };
    });
  }

  validateRevision(commandId, productId, revisionId, input) {
    return this.#run(commandId, "validate-scenario-revision", { productId, revisionId, ...input }, async (tx) => {
      await tx.lockProduct(productId);
      const workspace = await tx.readWorkspace(productId);
      const scenario = workspace.scenarios.find((item) => item.productId === productId && item.revisions.some((revision) => revision.id === revisionId));
      const revision = scenario?.revisions.find((item) => item.id === revisionId);
      if (!revision) throw new WorkbenchError("Scenario revision was not found.", 404, "NOT_FOUND");
      const asOf = instant(input.asOf, "asOf");
      const actuals = workspace.actuals.filter((item) => item.scenarioId === scenario.id && item.observedAt <= asOf);
      const model = compileSchedulingModel(revision, { policy: workspace.policies.at(-1) ?? null, resources: workspace.resources, trains: workspace.trains, actuals });
      const validation = validateScenario(model, { asOf, validatorSetVersion: input.validatorSetVersion });
      const run = await tx.saveValidation({ productId, scenarioId: scenario.id, revisionId, ...validation });
      return { status: 201, body: run };
    });
  }
}
