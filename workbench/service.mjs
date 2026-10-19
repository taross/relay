import { createHash } from "node:crypto";
import {
  WorkbenchError,
  assertCanApprove,
  assertCanRequestReview,
  assertExpectedVersion,
  assertReviewTransition,
  validateFeatureConsistency,
} from "./domain.mjs";

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

export function hashCommand(operation, payload) {
  return createHash("sha256").update(JSON.stringify(canonicalize({ operation, payload }))).digest("hex");
}

function required(value, label) {
  const trimmed = value.trim();
  if (!trimmed) throw new WorkbenchError(`${label} is required.`, 400, "INVALID_PAYLOAD");
  return trimmed;
}

function assertFeatureEditable(feature) {
  if (feature.reviewState === "In Review") {
    throw new WorkbenchError("Request changes before editing requirements that are in review.", 409, "REVIEW_LOCKED");
  }
  if (feature.reviewState === "Superseded") {
    throw new WorkbenchError("A superseded Feature requirements phase cannot be edited.", 409, "IMMUTABLE_FEATURE");
  }
}

export class WorkbenchService {
  constructor(repository) {
    this.repository = repository;
  }

  #runCommand(commandId, operation, payload, task) {
    return this.repository.runCommand(commandId, operation, hashCommand(operation, payload), task);
  }

  listProducts() {
    return this.repository.listProducts();
  }

  getProduct(productId) {
    return this.repository.getProduct(productId);
  }

  getFeature(featureId) {
    return this.repository.getFeatureWorkspace(featureId);
  }

  createProduct(commandId, input) {
    return this.#runCommand(commandId, "create-product", input, async (tx) => ({
      status: 201,
      body: await tx.createProduct({ name: required(input.name, "Product name"), description: input.description.trim() }),
    }));
  }

  createFeature(commandId, productId, input) {
    return this.#runCommand(commandId, "create-feature", { productId, ...input }, async (tx) => {
      const product = await tx.lockProduct(productId);
      assertExpectedVersion(product.version, input.expectedProductVersion, "Product");
      const feature = await tx.createFeature({
        productId,
        name: required(input.name, "Feature name"),
        summary: input.summary.trim(),
      });
      return { status: 201, body: feature };
    });
  }

  addSource(commandId, featureId, input) {
    return this.#runCommand(commandId, "add-requirement-source", { featureId, ...input }, async (tx) => {
      const feature = await tx.lockFeature(featureId);
      assertExpectedVersion(feature.version, input.expectedVersion, "Feature");
      assertFeatureEditable(feature);
      const source = await tx.addSource({
        featureId,
        content: required(input.content, "Source content"),
        provenance: input.provenance,
      });
      const updatedFeature = await tx.bumpFeatureDraft(featureId, feature.reviewState);
      return { status: 201, body: { source, feature: updatedFeature } };
    });
  }

  createCandidate(commandId, featureId, input) {
    return this.#runCommand(commandId, "create-requirement-candidate", { featureId, ...input }, async (tx) => {
      const feature = await tx.lockFeature(featureId);
      assertExpectedVersion(feature.version, input.expectedVersion, "Feature");
      assertFeatureEditable(feature);
      await tx.getSource(input.sourceId, featureId);
      const candidate = await tx.createCandidate({
        featureId,
        sourceId: input.sourceId,
        externalKey: input.externalKey.trim(),
        title: input.title.trim(),
        text: input.text.trim(),
      });
      const updatedFeature = await tx.bumpFeatureDraft(featureId, feature.reviewState);
      return { status: 201, body: { candidate, feature: updatedFeature } };
    });
  }

  editCandidate(commandId, featureId, candidateId, input) {
    return this.#runCommand(commandId, "edit-requirement-candidate", { featureId, candidateId, ...input }, async (tx) => {
      const feature = await tx.lockFeature(featureId);
      assertExpectedVersion(feature.version, input.expectedFeatureVersion, "Feature");
      assertFeatureEditable(feature);
      const candidate = await tx.lockCandidate(candidateId, featureId);
      assertExpectedVersion(candidate.version, input.expectedVersion, "Requirement candidate");
      if (candidate.status !== "Pending") throw new WorkbenchError("Only pending candidates can be edited.", 409, "CANDIDATE_DISPOSITIONED");
      const updatedCandidate = await tx.updateCandidate({
        id: candidateId,
        externalKey: input.externalKey.trim(),
        title: input.title.trim(),
        text: input.text.trim(),
      });
      const updatedFeature = await tx.bumpFeatureDraft(featureId, feature.reviewState);
      return { body: { candidate: updatedCandidate, feature: updatedFeature } };
    });
  }

  acceptCandidate(commandId, featureId, candidateId, input) {
    return this.#runCommand(commandId, "accept-requirement-candidate", { featureId, candidateId, ...input }, async (tx) => {
      const feature = await tx.lockFeature(featureId);
      assertExpectedVersion(feature.version, input.expectedFeatureVersion, "Feature");
      assertFeatureEditable(feature);
      const candidate = await tx.lockCandidate(candidateId, featureId);
      assertExpectedVersion(candidate.version, input.expectedVersion, "Requirement candidate");
      if (candidate.status !== "Pending") throw new WorkbenchError("Only pending candidates can be accepted.", 409, "CANDIDATE_DISPOSITIONED");
      candidate.decisionRationale = required(input.rationale, "Acceptance rationale");
      const revision = await tx.acceptCandidate({ candidate, referenceKeys: input.referenceKeys, conflicts: input.conflicts });
      const updatedFeature = await tx.bumpFeatureDraft(featureId, feature.reviewState);
      return { body: { candidate: { ...candidate, status: "Accepted", version: candidate.version + 1 }, revision, feature: updatedFeature } };
    });
  }

  rejectCandidate(commandId, featureId, candidateId, input) {
    return this.#runCommand(commandId, "reject-requirement-candidate", { featureId, candidateId, ...input }, async (tx) => {
      const feature = await tx.lockFeature(featureId);
      assertExpectedVersion(feature.version, input.expectedFeatureVersion, "Feature");
      assertFeatureEditable(feature);
      const candidate = await tx.lockCandidate(candidateId, featureId);
      assertExpectedVersion(candidate.version, input.expectedVersion, "Requirement candidate");
      if (candidate.status !== "Pending") throw new WorkbenchError("Only pending candidates can be rejected.", 409, "CANDIDATE_DISPOSITIONED");
      const updatedCandidate = await tx.rejectCandidate({ id: candidateId, rationale: required(input.rationale, "Rejection rationale") });
      const updatedFeature = await tx.bumpFeatureDraft(featureId, feature.reviewState);
      return { body: { candidate: updatedCandidate, feature: updatedFeature } };
    });
  }

  editRequirement(commandId, featureId, revisionId, input) {
    return this.#runCommand(commandId, "edit-requirement-revision", { featureId, revisionId, ...input }, async (tx) => {
      const feature = await tx.lockFeature(featureId);
      assertExpectedVersion(feature.version, input.expectedFeatureVersion, "Feature");
      assertFeatureEditable(feature);
      const revision = await tx.lockRevision(revisionId, featureId);
      assertExpectedVersion(revision.version, input.expectedVersion, "Requirement revision");
      const updatedRevision = await tx.editRevision({
        revision,
        title: input.title.trim(),
        text: input.text.trim(),
        externalKey: input.externalKey.trim(),
        referenceKeys: input.referenceKeys,
        conflicts: input.conflicts,
      });
      const updatedFeature = await tx.bumpFeatureDraft(featureId, feature.reviewState);
      return { status: revision.state === "Approved" ? 201 : 200, body: { revision: updatedRevision, feature: updatedFeature } };
    });
  }

  validateFeature(commandId, featureId, input) {
    return this.#runCommand(commandId, "validate-feature-requirements", { featureId, ...input }, async (tx) => {
      const feature = await tx.lockFeature(featureId);
      assertExpectedVersion(feature.version, input.expectedVersion, "Feature");
      const findings = validateFeatureConsistency(await tx.readSnapshot(featureId));
      const validation = await tx.saveValidation(featureId, feature.version, findings);
      return { body: validation };
    });
  }

  requestReview(commandId, featureId, input) {
    return this.#runCommand(commandId, "request-requirements-review", { featureId, ...input }, async (tx) => {
      const feature = await tx.lockFeature(featureId);
      assertExpectedVersion(feature.version, input.expectedVersion, "Feature");
      const findings = validateFeatureConsistency(await tx.readSnapshot(featureId));
      assertCanRequestReview(feature.reviewState, findings);
      assertReviewTransition(feature.reviewState, "In Review");
      const validation = await tx.saveValidation(featureId, feature.version, findings);
      const updatedFeature = await tx.setReviewState({
        featureId,
        fromState: feature.reviewState,
        toState: "In Review",
        actorName: required(input.actorName, "Reviewer name"),
        rationale: required(input.rationale, "Review rationale"),
      });
      return { body: { feature: updatedFeature, validation } };
    });
  }

  requestChanges(commandId, featureId, input) {
    return this.#runCommand(commandId, "request-requirements-changes", { featureId, ...input }, async (tx) => {
      const feature = await tx.lockFeature(featureId);
      assertExpectedVersion(feature.version, input.expectedVersion, "Feature");
      assertReviewTransition(feature.reviewState, "Changes Requested");
      const updatedFeature = await tx.setReviewState({
        featureId,
        fromState: feature.reviewState,
        toState: "Changes Requested",
        actorName: required(input.actorName, "Reviewer name"),
        rationale: required(input.rationale, "Change rationale"),
      });
      return { body: { feature: updatedFeature } };
    });
  }

  approve(commandId, featureId, input) {
    return this.#runCommand(commandId, "approve-requirements", { featureId, ...input }, async (tx) => {
      const feature = await tx.lockFeature(featureId);
      assertExpectedVersion(feature.version, input.expectedVersion, "Feature");
      const findings = validateFeatureConsistency(await tx.readSnapshot(featureId));
      assertCanApprove(feature.reviewState, findings, input.warningRationale);
      assertReviewTransition(feature.reviewState, "Approved");
      const validation = await tx.saveValidation(featureId, feature.version, findings);
      const baseline = await tx.approveBaseline({
        feature,
        validationRunId: validation.id,
        actorName: required(input.actorName, "Approver name"),
        rationale: required(input.rationale, "Approval rationale"),
        warningRationale: input.warningRationale.trim(),
      });
      return { status: 201, body: { baseline, validation } };
    });
  }
}
