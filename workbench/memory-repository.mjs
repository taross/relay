import { randomUUID } from "node:crypto";
import { WorkbenchError } from "./domain.mjs";

const now = () => new Date().toISOString();
const clone = (value) => structuredClone(value);

function missing(name) {
  throw new WorkbenchError(`${name} was not found.`, 404, "NOT_FOUND");
}

export class MemoryWorkbenchRepository {
  constructor() {
    this.state = {
      products: [], features: [], sources: [], candidates: [], requirements: [], revisions: [], validations: [], baselines: [], baselineValidityEvents: [], reviewEvents: [], receipts: new Map(),
    };
  }

  async listProducts() {
    return clone(this.state.products.map((product) => ({ ...product, featureCount: this.state.features.filter((feature) => feature.productId === product.id).length })));
  }

  async getProduct(productId) {
    const product = this.state.products.find((item) => item.id === productId);
    if (!product) missing("Product");
    return clone({ ...product, features: this.state.features.filter((feature) => feature.productId === productId) });
  }

  async getFeatureWorkspace(featureId) {
    const feature = this.state.features.find((item) => item.id === featureId);
    if (!feature) missing("Feature");
    const product = this.state.products.find((item) => item.id === feature.productId);
    const latestByRequirement = this.state.requirements.filter((item) => item.featureId === featureId).map((requirement) =>
      this.state.revisions.filter((revision) => revision.requirementId === requirement.id).sort((left, right) => right.revisionNumber - left.revisionNumber)[0],
    );
    return clone({
      product: { id: product.id, name: product.name, version: product.version },
      feature,
      sources: this.state.sources.filter((item) => item.featureId === featureId),
      candidates: this.state.candidates.filter((item) => item.featureId === featureId),
      requirements: latestByRequirement,
      latestValidation: this.state.validations.filter((item) => item.featureId === featureId).at(-1) ?? null,
      baselines: this.state.baselines.filter((item) => item.featureId === featureId).sort((left, right) => right.baselineNumber - left.baselineNumber).map((baseline) => {
        const latestValidity = this.state.baselineValidityEvents.filter((event) => event.baselineId === baseline.id).at(-1);
        return { ...baseline, validity: latestValidity?.validity ?? baseline.validity };
      }),
    });
  }

  async runCommand(commandId, operation, requestHash, task) {
    const receipt = this.state.receipts.get(commandId);
    if (receipt) {
      if (receipt.operation !== operation || receipt.requestHash !== requestHash) {
        throw new WorkbenchError("The idempotency key was already used for a different command payload.", 409, "IDEMPOTENCY_KEY_REUSED");
      }
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

  #transaction() {
    return {
      createProduct: async ({ name, description }) => {
        const createdAt = now();
        const product = { id: randomUUID(), name, description, version: 1, createdAt, updatedAt: createdAt };
        this.state.products.push(product);
        return clone(product);
      },
      lockProduct: async (id) => clone(this.#find(this.state.products, id, "Product")),
      createFeature: async ({ productId, name, summary }) => {
        if (this.state.features.some((item) => item.productId === productId && item.name === name)) throw new WorkbenchError("A resource with the same identity already exists.", 409, "DUPLICATE_RESOURCE");
        const createdAt = now();
        const feature = { id: randomUUID(), productId, name, summary, reviewState: "Not Started", version: 1, createdAt, updatedAt: createdAt };
        this.state.features.push(feature);
        const product = this.#find(this.state.products, productId, "Product");
        product.version += 1;
        product.updatedAt = now();
        return clone(feature);
      },
      lockFeature: async (id) => clone(this.#find(this.state.features, id, "Feature")),
      addSource: async ({ featureId, content, provenance }) => {
        const source = { id: randomUUID(), featureId, content, provenance, createdAt: now() };
        this.state.sources.push(source);
        return clone(source);
      },
      getSource: async (id, featureId) => {
        const source = this.state.sources.find((item) => item.id === id && item.featureId === featureId);
        if (!source) missing("Requirement source");
        return clone(source);
      },
      createCandidate: async ({ featureId, sourceId, externalKey, title, text }) => {
        const createdAt = now();
        const candidate = { id: randomUUID(), featureId, sourceId, externalKey, title, text, status: "Pending", decisionRationale: "", acceptedRequirementId: null, version: 1, createdAt, updatedAt: createdAt };
        this.state.candidates.push(candidate);
        return clone(candidate);
      },
      lockCandidate: async (id, featureId) => {
        const candidate = this.state.candidates.find((item) => item.id === id && item.featureId === featureId);
        if (!candidate) missing("Requirement candidate");
        return clone(candidate);
      },
      updateCandidate: async ({ id, externalKey, title, text }) => {
        const candidate = this.#find(this.state.candidates, id, "Requirement candidate");
        Object.assign(candidate, { externalKey, title, text, version: candidate.version + 1, updatedAt: now() });
        return clone(candidate);
      },
      rejectCandidate: async ({ id, rationale }) => {
        const candidate = this.#find(this.state.candidates, id, "Requirement candidate");
        Object.assign(candidate, { status: "Rejected", decisionRationale: rationale, version: candidate.version + 1, updatedAt: now() });
        return clone(candidate);
      },
      acceptCandidate: async ({ candidate, referenceKeys, conflicts }) => {
        const stored = this.#find(this.state.candidates, candidate.id, "Requirement candidate");
        const requirement = { id: randomUUID(), featureId: candidate.featureId, externalKey: candidate.externalKey, createdAt: now() };
        const revision = { id: randomUUID(), requirementId: requirement.id, externalKey: candidate.externalKey, revisionNumber: 1, title: candidate.title, text: candidate.text, state: "Draft", predecessorRevisionId: null, version: 1, referenceKeys: [...referenceKeys], conflicts: clone(conflicts), createdAt: now() };
        this.state.requirements.push(requirement);
        this.state.revisions.push(revision);
        Object.assign(stored, { status: "Accepted", acceptedRequirementId: requirement.id, decisionRationale: candidate.decisionRationale, version: stored.version + 1, updatedAt: now() });
        return clone(revision);
      },
      lockRevision: async (id, featureId) => {
        const revision = this.#find(this.state.revisions, id, "Requirement revision");
        const requirement = this.#find(this.state.requirements, revision.requirementId, "Requirement");
        if (requirement.featureId !== featureId) missing("Requirement revision");
        return clone(revision);
      },
      editRevision: async ({ revision, title, text, externalKey, referenceKeys, conflicts }) => {
        const requirement = this.#find(this.state.requirements, revision.requirementId, "Requirement");
        requirement.externalKey = externalKey;
        if (revision.state === "Draft") {
          const stored = this.#find(this.state.revisions, revision.id, "Requirement revision");
          Object.assign(stored, { externalKey, title, text, referenceKeys: [...referenceKeys], conflicts: clone(conflicts), version: stored.version + 1 });
          return clone(stored);
        }
        if (revision.state !== "Approved") throw new WorkbenchError("A superseded requirement revision cannot be edited.", 409, "IMMUTABLE_REVISION");
        this.#find(this.state.revisions, revision.id, "Requirement revision").state = "Superseded";
        const successor = { id: randomUUID(), requirementId: revision.requirementId, externalKey, revisionNumber: revision.revisionNumber + 1, title, text, state: "Draft", predecessorRevisionId: revision.id, version: 1, referenceKeys: [...referenceKeys], conflicts: clone(conflicts), createdAt: now() };
        this.state.revisions.push(successor);
        const baseline = this.state.baselines.filter((item) => item.featureId === requirement.featureId).at(-1);
        if (baseline) this.state.baselineValidityEvents.push({ id: randomUUID(), baselineId: baseline.id, validity: "Impacted", rationale: "A successor Requirement revision was created after approval.", createdAt: now() });
        return clone(successor);
      },
      bumpFeatureDraft: async (featureId, currentState) => {
        const feature = this.#find(this.state.features, featureId, "Feature");
        if (currentState === "Approved") {
          const baseline = this.state.baselines.filter((item) => item.featureId === featureId).at(-1);
          const latestValidity = baseline
            ? this.state.baselineValidityEvents.filter((item) => item.baselineId === baseline.id).at(-1)?.validity
            : undefined;
          if (baseline && latestValidity !== "Impacted") {
            this.state.baselineValidityEvents.push({ id: randomUUID(), baselineId: baseline.id, validity: "Impacted", rationale: "Requirements work changed after approval.", createdAt: now() });
          }
        }
        if (["Not Started", "Approved", "Changes Requested"].includes(currentState)) feature.reviewState = "Draft";
        feature.version += 1;
        feature.updatedAt = now();
        return clone(feature);
      },
      setReviewState: async ({ featureId, fromState, toState, actorName, rationale }) => {
        const feature = this.#find(this.state.features, featureId, "Feature");
        feature.reviewState = toState;
        feature.version += 1;
        feature.updatedAt = now();
        this.state.reviewEvents.push({ id: randomUUID(), featureId, fromState, toState, actorName, rationale, createdAt: now() });
        return clone(feature);
      },
      readSnapshot: async (featureId) => {
        const requirements = this.state.requirements.filter((item) => item.featureId === featureId).map((requirement) =>
          this.state.revisions.filter((revision) => revision.requirementId === requirement.id).sort((left, right) => right.revisionNumber - left.revisionNumber)[0],
        );
        return clone({ requirements, candidates: this.state.candidates.filter((item) => item.featureId === featureId).map(({ id, status }) => ({ id, status })) });
      },
      saveValidation: async (featureId, featureVersion, findings) => {
        const validation = { id: randomUUID(), featureId, featureVersion, validatorVersion: "phase1-deterministic-v1", createdAt: now(), findings: clone(findings) };
        this.state.validations.push(validation);
        return clone(validation);
      },
      approveBaseline: async ({ feature, validationRunId, actorName, rationale, warningRationale }) => {
        const current = this.state.requirements.filter((item) => item.featureId === feature.id).map((requirement) =>
          this.state.revisions.filter((revision) => revision.requirementId === requirement.id).sort((left, right) => right.revisionNumber - left.revisionNumber)[0],
        );
        if (current.some((revision) => revision.state !== "Draft")) throw new WorkbenchError("Only a complete draft revision set can be approved.", 409, "IMMUTABLE_REVISION");
        for (const revision of current) this.#find(this.state.revisions, revision.id, "Requirement revision").state = "Approved";
        const baselineNumber = this.state.baselines.filter((item) => item.featureId === feature.id).length + 1;
        const baseline = { id: randomUUID(), featureId: feature.id, baselineNumber, validity: "Current", validationRunId, revisionIds: current.map((item) => item.id), createdAt: now(), revisionCount: current.length, approval: { id: randomUUID(), actorName, rationale, warningRationale: warningRationale || null, createdAt: now() } };
        this.state.baselines.push(baseline);
        this.state.baselineValidityEvents.push({ id: randomUUID(), baselineId: baseline.id, validity: "Current", rationale: "The Requirements phase was approved with this frozen revision set.", createdAt: now() });
        const storedFeature = this.#find(this.state.features, feature.id, "Feature");
        storedFeature.reviewState = "Approved";
        storedFeature.version += 1;
        storedFeature.updatedAt = now();
        return clone({ ...baseline, approvalId: baseline.approval.id, feature: storedFeature });
      },
    };
  }

  #find(collection, id, name) {
    const item = collection.find((entry) => entry.id === id);
    if (!item) missing(name);
    return item;
  }
}
