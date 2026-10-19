import { randomUUID } from "node:crypto";
import { WorkbenchError } from "./domain.mjs";

const clone = (value) => structuredClone(value);
const now = () => new Date().toISOString();
const defaultPhase = () => ({ reviewState: "Not Started", version: 1, updatedAt: null });

export class MemoryPhase2Repository {
  constructor(initial = {}) {
    const feature = initial.feature ?? { id: randomUUID(), productId: randomUUID(), name: "Feature", summary: "", reviewState: "Approved", version: 1, createdAt: now(), updatedAt: now() };
    this.requirementBaselineId = initial.requirementBaselineId ?? randomUUID();
    this.state = {
      product: initial.product ?? { id: feature.productId, name: "Product", version: 1 },
      feature,
      phaseStates: {
        Requirements: { reviewState: feature.reviewState, version: feature.version, updatedAt: feature.updatedAt },
        Specification: defaultPhase(),
        "Solution Design": defaultPhase(),
        "Verification Planning": defaultPhase(),
        "Delivery Readiness": defaultPhase(),
      },
      requirements: initial.requirements ?? [],
      specification: null,
      design: null,
      verificationPlan: null,
      workPackages: [],
      deliverables: [],
      artifactBaselines: [],
      readinessBaselines: [],
      validations: [],
      receipts: new Map(),
    };
  }

  getWorkspace() {
    return Promise.resolve(this.#workspace());
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
    const { receipts: _receipts, validations, ...workspace } = this.state;
    const latestValidations = Object.fromEntries(["Specification", "Solution Design", "Verification Planning"].map((phase) => [phase, validations.filter((item) => item.phase === phase).at(-1)]).filter((entry) => entry[1]));
    const latestReadinessValidation = validations.filter((item) => item.phase === "Delivery Readiness").at(-1) ?? null;
    return clone({ ...workspace, latestValidations, latestReadinessValidation });
  }

  #bumpFeature() {
    this.state.feature.version += 1;
    this.state.feature.updatedAt = now();
  }

  #impactArtifactBaselines(changedPhase) {
    const order = ["Specification", "Solution Design", "Verification Planning"];
    for (const phase of order.slice(order.indexOf(changedPhase))) {
      const baseline = this.state.artifactBaselines.filter((item) => item.phase === phase).at(-1);
      if (baseline) baseline.validity = "Impacted";
    }
  }

  #impactReadiness(rationale) {
    const baseline = this.state.readinessBaselines.at(-1);
    if (baseline && baseline.validity !== "Impacted") {
      baseline.validity = "Impacted";
      baseline.validityEvents.push({ validity: "Impacted", rationale, createdAt: now() });
    }
  }

  #phase(phase) {
    const state = this.state.phaseStates[phase];
    if (!state) throw new WorkbenchError("Phase was not found.", 404, "NOT_FOUND");
    return state;
  }

  #transaction() {
    return {
      lockFeature: async (featureId) => {
        if (featureId !== this.state.feature.id) throw new WorkbenchError("Feature was not found.", 404, "NOT_FOUND");
        return clone(this.state.feature);
      },
      readWorkspace: async () => this.#workspace(),
      saveArtifact: async (input) => {
        const property = input.phase === "Specification" ? "specification" : input.phase === "Solution Design" ? "design" : "verificationPlan";
        const phase = this.#phase(input.phase);
        if (phase.version !== input.expectedPhaseVersion) throw new WorkbenchError(`${input.phase} changed since it was loaded. Reload and retry.`, 409, "STALE_VERSION");
        const current = this.state[property];
        let revision;
        let created = false;
        if (!current) {
          created = true;
          revision = { id: randomUUID(), revisionNumber: 1, state: "Draft", predecessorRevisionId: null, version: 1, createdAt: now() };
        } else if (current.state === "Draft") {
          if (current.version !== input.expectedRevisionVersion) throw new WorkbenchError(`${input.phase} revision changed since it was loaded. Reload and retry.`, 409, "STALE_VERSION");
          revision = { ...current, version: current.version + 1 };
        } else if (current.state === "Approved") {
          if (current.version !== input.expectedRevisionVersion) throw new WorkbenchError(`${input.phase} revision changed since it was loaded. Reload and retry.`, 409, "STALE_VERSION");
          current.state = "Superseded";
          created = true;
          revision = { id: randomUUID(), revisionNumber: current.revisionNumber + 1, state: "Draft", predecessorRevisionId: current.id, version: 1, createdAt: now() };
          this.#impactArtifactBaselines(input.phase);
        } else throw new WorkbenchError("A superseded revision cannot be edited.", 409, "IMMUTABLE_REVISION");
        Object.assign(revision, { title: input.title, authorName: input.authorName, updatedAt: now() });
        if (input.phase === "Specification") Object.assign(revision, { behavior: input.body, criteria: input.criteria.map((item) => ({ id: randomUUID(), ...clone(item) })), requirementRevisionIds: [...input.requirementRevisionIds] });
        if (input.phase === "Solution Design") Object.assign(revision, { summary: input.body, specificationRevisionIds: [...input.specificationRevisionIds], requirementRevisionIds: [...input.requirementRevisionIds], acceptanceCriterionIds: [...input.acceptanceCriterionIds] });
        if (input.phase === "Verification Planning") Object.assign(revision, { cases: input.cases.map((item) => ({ id: randomUUID(), ...clone(item) })) });
        this.state[property] = revision;
        Object.assign(phase, { reviewState: "Draft", version: phase.version + 1, updatedAt: now() });
        this.#bumpFeature();
        this.#impactReadiness(`${input.phase} changed after Delivery Readiness approval.`);
        return { created, workspace: this.#workspace() };
      },
      saveWorkPackage: async (input) => {
        let item = input.id ? this.state.workPackages.find((candidate) => candidate.id === input.id) : null;
        const created = !item;
        if (input.id && !item) throw new WorkbenchError("Work Package was not found.", 404, "NOT_FOUND");
        if (item && item.version !== input.expectedVersion) throw new WorkbenchError("Work Package changed since it was loaded. Reload and retry.", 409, "STALE_VERSION");
        if (!item) {
          item = { id: randomUUID(), version: 1, createdAt: now() };
          this.state.workPackages.push(item);
        } else item.version += 1;
        Object.assign(item, { key: input.key, type: input.type, description: input.description, owningTeam: input.owningTeam, predecessorIds: [...input.predecessorIds], designRevisionIds: [...input.designRevisionIds], verificationRevisionIds: [...input.verificationRevisionIds], updatedAt: now() });
        const phase = this.#phase("Delivery Readiness");
        Object.assign(phase, { reviewState: "Draft", version: phase.version + 1, updatedAt: now() });
        this.#bumpFeature();
        this.#impactReadiness("A Work Package changed after Delivery Readiness approval.");
        return { created, workspace: this.#workspace() };
      },
      saveDeliverable: async (input) => {
        let item = input.deliverableId ? this.state.deliverables.find((candidate) => candidate.deliverableId === input.deliverableId) : null;
        let created = !item;
        if (input.deliverableId && !item) throw new WorkbenchError("Deliverable was not found.", 404, "NOT_FOUND");
        if (item && item.version !== input.expectedVersion) throw new WorkbenchError("Deliverable revision changed since it was loaded. Reload and retry.", 409, "STALE_VERSION");
        if (!item) {
          item = { id: randomUUID(), deliverableId: randomUUID(), revisionNumber: 1, state: "Draft", predecessorRevisionId: null, version: 1, createdAt: now(), approval: null };
          this.state.deliverables.push(item);
        } else if (item.state === "Draft") item.version += 1;
        else if (item.state === "Approved") {
          const predecessor = item;
          predecessor.state = "Superseded";
          item = { id: randomUUID(), deliverableId: predecessor.deliverableId, revisionNumber: predecessor.revisionNumber + 1, state: "Draft", predecessorRevisionId: predecessor.id, version: 1, createdAt: now(), approval: null };
          this.state.deliverables = this.state.deliverables.filter((candidate) => candidate !== predecessor);
          this.state.deliverables.push(item);
          created = true;
        } else throw new WorkbenchError("A superseded Deliverable revision cannot be edited.", 409, "IMMUTABLE_REVISION");
        Object.assign(item, { name: input.name, description: input.description, targetSystem: input.targetSystem, targetEnvironment: input.targetEnvironment, artifactRevisionLabel: input.artifactRevisionLabel, targetReleaseTrainId: null, authorName: input.authorName, workPackageIds: [...input.workPackageIds], predecessorIds: [...input.predecessorIds], readinessConditions: clone(input.readinessConditions), updatedAt: now() });
        const phase = this.#phase("Delivery Readiness");
        Object.assign(phase, { reviewState: "Draft", version: phase.version + 1, updatedAt: now() });
        this.#bumpFeature();
        this.#impactReadiness("A Deliverable changed after Delivery Readiness approval.");
        return { created, workspace: this.#workspace() };
      },
      saveArtifactValidation: async (input) => {
        const validation = { id: randomUUID(), validatorVersion: "phase2-deterministic-v1", createdAt: now(), ...clone(input) };
        this.state.validations.push(validation);
        return clone(validation);
      },
      saveReadinessValidation: async (input) => {
        const validation = { id: randomUUID(), phase: "Delivery Readiness", validatorVersion: "phase2-readiness-deterministic-v1", createdAt: now(), ...clone(input) };
        this.state.validations.push(validation);
        return clone(validation);
      },
      setPhaseState: async (input) => {
        const phase = this.#phase(input.phase);
        if (phase.version !== input.expectedVersion) throw new WorkbenchError(`${input.phase} changed since it was loaded. Reload and retry.`, 409, "STALE_VERSION");
        Object.assign(phase, { reviewState: input.toState, version: phase.version + 1, updatedAt: now() });
        return clone(phase);
      },
      approveArtifact: async (input) => {
        const property = input.phase === "Specification" ? "specification" : input.phase === "Solution Design" ? "design" : "verificationPlan";
        const revision = this.state[property];
        if (!revision || revision.id !== input.revisionId || revision.state !== "Draft") throw new WorkbenchError("Only the current Draft revision can be approved.", 409, "IMMUTABLE_REVISION");
        revision.state = "Approved";
        const baseline = { id: randomUUID(), phase: input.phase, baselineNumber: this.state.artifactBaselines.filter((item) => item.phase === input.phase).length + 1, revisionId: revision.id, validationRunId: input.validationRunId, validity: "Current", createdAt: now(), approval: { actorName: input.actorName, rationale: input.rationale, warningRationale: input.warningRationale, createdAt: now() } };
        this.state.artifactBaselines.push(baseline);
        const phase = this.#phase(input.phase);
        if (phase.version !== input.expectedVersion) throw new WorkbenchError(`${input.phase} changed since it was loaded. Reload and retry.`, 409, "STALE_VERSION");
        Object.assign(phase, { reviewState: "Approved", version: phase.version + 1, updatedAt: now() });
        return { baselineId: baseline.id, phaseState: clone(phase), workspace: this.#workspace() };
      },
      approveReadiness: async (input) => {
        const phase = this.#phase("Delivery Readiness");
        if (phase.version !== input.expectedVersion) throw new WorkbenchError("Delivery Readiness changed since it was loaded. Reload and retry.", 409, "STALE_VERSION");
        for (const item of this.state.deliverables) {
          item.state = "Approved";
          item.approval = { id: randomUUID(), actorName: input.actorName, rationale: input.rationale, createdAt: now() };
        }
        const baseline = { id: randomUUID(), baselineNumber: this.state.readinessBaselines.length + 1, requirementBaselineId: this.requirementBaselineId, specificationRevisionId: input.workspace.specification.id, designRevisionId: input.workspace.design.id, verificationRevisionId: input.workspace.verificationPlan.id, validationRunId: input.validationRunId, workPackages: clone(this.state.workPackages), deliverableRevisionIds: this.state.deliverables.map((item) => item.id), validity: "Current", validityEvents: [{ validity: "Current", rationale: "Delivery Readiness was approved with this frozen snapshot.", createdAt: now() }], createdAt: now(), approval: { actorName: input.actorName, rationale: input.rationale, warningRationale: input.warningRationale, createdAt: now() } };
        this.state.readinessBaselines.push(baseline);
        Object.assign(phase, { reviewState: "Approved", version: phase.version + 1, updatedAt: now() });
        return { baselineId: baseline.id, phaseState: clone(phase), workspace: this.#workspace() };
      },
    };
  }
}
