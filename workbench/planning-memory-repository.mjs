import { randomUUID } from "node:crypto";
import { WorkbenchError } from "./domain.mjs";

const clone = structuredClone;
const now = () => new Date().toISOString();

export class MemoryPlanningRepository {
  constructor(initial = {}) {
    const product = initial.product ?? { id: randomUUID(), name: "Product", version: 1 };
    this.state = { product, deliveries: initial.deliveries ?? [], deliverables: initial.deliverables ?? [], policies: initial.policies ?? [], resources: initial.resources ?? [], trains: initial.trains ?? [], scenarios: initial.scenarios ?? [], actuals: initial.actuals ?? [], validations: initial.validations ?? [], receipts: new Map() };
  }

  getWorkspace(productId) {
    if (productId !== this.state.product.id) throw new WorkbenchError("Product was not found.", 404, "NOT_FOUND");
    return Promise.resolve(this.#workspace());
  }

  getScenarioRevisions(revisionIds) {
    const revisions = this.state.scenarios.flatMap((scenario) => scenario.revisions).filter((revision) => revisionIds.includes(revision.id));
    return Promise.resolve(clone(revisions));
  }

  async runCommand(commandId, operation, requestHash, task) {
    const receipt = this.state.receipts.get(commandId);
    if (receipt) {
      if (receipt.operation !== operation || receipt.requestHash !== requestHash) throw new WorkbenchError("The idempotency key was already used for a different command payload.", 409, "IDEMPOTENCY_KEY_REUSED");
      return clone({ replayed: true, status: receipt.status, body: receipt.body });
    }
    const before = clone({ ...this.state, receipts: [...this.state.receipts] });
    try {
      const result = await task(this.#transaction());
      const status = result.status ?? 200;
      const body = result.body ?? result;
      this.state.receipts.set(commandId, clone({ operation, requestHash, status, body }));
      return clone({ replayed: false, status, body });
    } catch (error) {
      this.state = { ...before, receipts: new Map(before.receipts) };
      throw error;
    }
  }

  #workspace() {
    const { receipts: _receipts, ...state } = this.state;
    return clone(state);
  }

  #bumpProduct(expectedVersion) {
    if (this.state.product.version !== expectedVersion) throw new WorkbenchError("Product changed since it was loaded. Reload and retry.", 409, "STALE_VERSION", { expected: expectedVersion, actual: this.state.product.version });
    this.state.product.version += 1;
  }

  #scenario(id) {
    const scenario = this.state.scenarios.find((item) => item.id === id);
    if (!scenario) throw new WorkbenchError("Scenario was not found.", 404, "NOT_FOUND");
    return scenario;
  }

  #transaction() {
    return {
      lockProduct: async (productId) => {
        if (productId !== this.state.product.id) throw new WorkbenchError("Product was not found.", 404, "NOT_FOUND");
        return clone(this.state.product);
      },
      readWorkspace: async () => this.#workspace(),
      savePolicy: async (input) => {
        this.#bumpProduct(input.expectedProductVersion);
        const previous = this.state.policies.at(-1) ?? null;
        const policy = { id: randomUUID(), productId: input.productId, revisionNumber: (previous?.revisionNumber ?? 0) + 1, predecessorRevisionId: previous?.id ?? null, version: 1, rules: clone(input.rules), createdAt: now() };
        this.state.policies.push(policy);
        return { created: true, workspace: this.#workspace(), policy };
      },
      saveResource: async (input) => {
        this.#bumpProduct(input.expectedProductVersion);
        let resource = input.id ? this.state.resources.find((item) => item.id === input.id) : null;
        if (input.id && !resource) throw new WorkbenchError("Resource was not found.", 404, "NOT_FOUND");
        if (resource && resource.version !== input.expectedVersion) throw new WorkbenchError("Resource changed since it was loaded. Reload and retry.", 409, "STALE_VERSION");
        if (!resource) { resource = { id: randomUUID(), productId: input.productId, version: 1, createdAt: now() }; this.state.resources.push(resource); }
        else resource.version += 1;
        Object.assign(resource, { name: input.name, capacity: clone(input.capacity), updatedAt: now() });
        return { created: !input.id, workspace: this.#workspace(), resource: clone(resource) };
      },
      saveDelivery: async (input) => {
        this.#bumpProduct(input.expectedProductVersion);
        let delivery = input.id ? this.state.deliveries.find((item) => item.id === input.id) : null;
        if (input.id && !delivery) throw new WorkbenchError("Delivery was not found.", 404, "NOT_FOUND");
        if (delivery && delivery.version !== input.expectedVersion) throw new WorkbenchError("Delivery changed since it was loaded. Reload and retry.", 409, "STALE_VERSION");
        if (!delivery) { delivery = { id: randomUUID(), productId: input.productId, version: 1, createdAt: now() }; this.state.deliveries.push(delivery); }
        else delivery.version += 1;
        Object.assign(delivery, { name: input.name, updatedAt: now() });
        return { created: !input.id, workspace: this.#workspace(), delivery: clone(delivery) };
      },
      saveTrain: async (input) => {
        this.#bumpProduct(input.expectedProductVersion);
        let train = input.id ? this.state.trains.find((item) => item.id === input.id) : null;
        if (input.id && !train) throw new WorkbenchError("Train was not found.", 404, "NOT_FOUND");
        if (train && train.version !== input.expectedVersion) throw new WorkbenchError("Train changed since it was loaded. Reload and retry.", 409, "STALE_VERSION");
        if (!train) { train = { id: randomUUID(), productId: input.productId, version: 1, createdAt: now() }; this.state.trains.push(train); }
        else train.version += 1;
        Object.assign(train, { name: input.name, cutoffAt: input.cutoffAt, updatedAt: now() });
        return { created: !input.id, workspace: this.#workspace(), train: clone(train) };
      },
      createScenario: async (input) => {
        this.#bumpProduct(input.expectedProductVersion);
        const scenario = { id: randomUUID(), productId: input.productId, deliveryId: input.deliveryId, name: input.name, provenance: "manual", version: 1, revisions: [], createdAt: now(), updatedAt: now() };
        this.state.scenarios.push(scenario);
        return { scenario: clone(scenario), workspace: this.#workspace() };
      },
      createRevision: async (input) => {
        const scenario = this.#scenario(input.scenarioId);
        if (scenario.productId !== input.productId) throw new WorkbenchError("Scenario was not found.", 404, "NOT_FOUND");
        if (scenario.version !== input.expectedScenarioVersion) throw new WorkbenchError("Scenario changed since it was loaded. Reload and retry.", 409, "STALE_VERSION");
        const previous = scenario.revisions.at(-1) ?? null;
        const revision = { id: randomUUID(), scenarioId: scenario.id, productId: scenario.productId, deliveryId: scenario.deliveryId, revisionNumber: (previous?.revisionNumber ?? 0) + 1, predecessorRevisionId: previous?.id ?? null, provenance: "manual", inputHash: input.inputHash, activities: clone(input.activities), deliverables: clone(input.deliverables), constraints: clone(input.constraints), createdAt: now() };
        scenario.revisions.push(revision); scenario.version += 1; scenario.updatedAt = now();
        return { revision: clone(revision), scenario: clone(scenario), workspace: this.#workspace() };
      },
      cloneScenario: async (input) => {
        this.#bumpProduct(input.expectedProductVersion);
        const source = this.#scenario(input.scenarioId);
        if (source.productId !== input.productId) throw new WorkbenchError("Scenario was not found.", 404, "NOT_FOUND");
        const sourceRevision = source.revisions.find((item) => item.id === input.revisionId);
        if (!sourceRevision) throw new WorkbenchError("Scenario revision was not found.", 404, "NOT_FOUND");
        const scenario = { id: randomUUID(), productId: source.productId, deliveryId: source.deliveryId, name: input.name, provenance: "manual", version: 1, revisions: [], clonedFromRevisionId: sourceRevision.id, createdAt: now(), updatedAt: now() };
        const revision = { ...clone(sourceRevision), id: randomUUID(), scenarioId: scenario.id, revisionNumber: 1, predecessorRevisionId: null, provenance: "manual", createdAt: now() };
        scenario.revisions.push(revision); this.state.scenarios.push(scenario);
        return { scenario: clone(scenario), workspace: this.#workspace() };
      },
      appendActual: async (input) => {
        const scenario = this.#scenario(input.scenarioId);
        if (scenario.productId !== input.productId) throw new WorkbenchError("Scenario was not found.", 404, "NOT_FOUND");
        const actual = { id: randomUUID(), productId: input.productId, scenarioId: input.scenarioId, activityId: input.activityId, kind: input.kind, value: clone(input.value), observedAt: input.observedAt, recordedAt: now() };
        this.state.actuals.push(actual);
        return { actual: clone(actual), workspace: this.#workspace() };
      },
      saveValidation: async (input) => {
        const run = { id: randomUUID(), ...clone(input), createdAt: now() };
        this.state.validations.push(run);
        return clone(run);
      },
    };
  }
}
