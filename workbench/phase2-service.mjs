import { hashCommand } from "./service.mjs";
import { WorkbenchError } from "./domain.mjs";
import {
  ARTIFACT_PHASES,
  assertApprovable,
  assertEditablePhase,
  assertExpectedVersion,
  assertPhaseTransition,
  assertReviewable,
  validateArtifact,
  validateDeliveryReadiness,
} from "./phase2-domain.mjs";

function required(value, label) {
  const trimmed = value.trim();
  if (!trimmed) throw new WorkbenchError(`${label} is required.`, 400, "INVALID_PAYLOAD");
  return trimmed;
}

const trimmed = (value) => value.trim();
const trimmedList = (values) => [...new Set(values.map(trimmed).filter(Boolean))];

function currentRevision(workspace, phase) {
  if (phase === "Specification") return workspace.specification;
  if (phase === "Solution Design") return workspace.design;
  if (phase === "Verification Planning") return workspace.verificationPlan;
  return null;
}

function blockingStructuralFindings(findings) {
  const structuralCodes = new Set(["WORK_PACKAGE_PREDECESSOR_MISSING", "WORK_PACKAGE_CYCLE", "DELIVERABLE_WORK_PACKAGE_TRACE_INVALID", "DELIVERABLE_PREDECESSOR_MISSING", "DELIVERABLE_CYCLE", "RELEASE_ASSIGNMENT_OUT_OF_SCOPE"]);
  return findings.filter((item) => item.severity === "Blocker" && structuralCodes.has(item.code));
}

export class Phase2Service {
  constructor(repository) {
    this.repository = repository;
  }

  getWorkspace(featureId) {
    return this.repository.getWorkspace(featureId);
  }

  #run(commandId, operation, payload, task) {
    return this.repository.runCommand(commandId, operation, hashCommand(operation, payload), task);
  }

  saveSpecification(commandId, featureId, input) {
    return this.#saveArtifact(commandId, featureId, "Specification", {
      ...input,
      title: input.title.trim(),
      body: input.behavior.trim(),
      criteria: input.criteria.map((item) => ({ key: required(item.key, "Acceptance criterion key"), text: required(item.text, "Acceptance criterion text"), requirementRevisionIds: trimmedList(item.requirementRevisionIds) })),
      requirementRevisionIds: trimmedList(input.requirementRevisionIds),
    });
  }

  saveDesign(commandId, featureId, input) {
    return this.#saveArtifact(commandId, featureId, "Solution Design", {
      ...input,
      title: input.title.trim(),
      body: input.summary.trim(),
      specificationRevisionIds: trimmedList(input.specificationRevisionIds),
      requirementRevisionIds: trimmedList(input.requirementRevisionIds),
      acceptanceCriterionIds: trimmedList(input.acceptanceCriterionIds),
    });
  }

  saveVerificationPlan(commandId, featureId, input) {
    return this.#saveArtifact(commandId, featureId, "Verification Planning", {
      ...input,
      title: input.title.trim(),
      cases: input.cases.map((item) => ({
        key: required(item.key, "Verification case key"),
        method: item.method.trim(),
        successCriteria: item.successCriteria.trim(),
        executionCondition: item.executionCondition.trim(),
        responsibleTeam: item.responsibleTeam.trim(),
        specificationRevisionIds: trimmedList(item.specificationRevisionIds),
        requirementRevisionIds: trimmedList(item.requirementRevisionIds),
        acceptanceCriterionIds: trimmedList(item.acceptanceCriterionIds),
      })),
    });
  }

  #saveArtifact(commandId, featureId, phase, input) {
    return this.#run(commandId, `save-${phase.toLocaleLowerCase().replaceAll(" ", "-")}`, { featureId, ...input }, async (tx) => {
      const feature = await tx.lockFeature(featureId);
      assertExpectedVersion(feature.version, input.expectedFeatureVersion, "Feature");
      const workspace = await tx.readWorkspace(featureId);
      assertExpectedVersion(workspace.phaseStates[phase].version, input.expectedPhaseVersion, phase);
      assertEditablePhase(workspace.phaseStates[phase].reviewState);
      const result = await tx.saveArtifact({ ...input, featureId, phase, authorName: required(input.authorName, "Author name") });
      return { status: result.created ? 201 : 200, body: result.workspace };
    });
  }

  saveWorkPackage(commandId, featureId, workPackageId, input) {
    return this.#run(commandId, workPackageId ? "update-work-package" : "create-work-package", { featureId, workPackageId, ...input }, async (tx) => {
      const feature = await tx.lockFeature(featureId);
      assertExpectedVersion(feature.version, input.expectedFeatureVersion, "Feature");
      const workspace = await tx.readWorkspace(featureId);
      assertExpectedVersion(workspace.phaseStates["Delivery Readiness"].version, input.expectedPhaseVersion, "Delivery Readiness");
      assertEditablePhase(workspace.phaseStates["Delivery Readiness"].reviewState);
      const result = await tx.saveWorkPackage({
        id: workPackageId,
        featureId,
        expectedVersion: input.expectedVersion,
        expectedPhaseVersion: input.expectedPhaseVersion,
        key: required(input.key, "Work Package key"),
        type: input.type,
        description: required(input.description, "Work Package description"),
        owningTeam: input.owningTeam.trim(),
        predecessorIds: trimmedList(input.predecessorIds),
        designRevisionIds: trimmedList(input.designRevisionIds),
        verificationRevisionIds: trimmedList(input.verificationRevisionIds),
      });
      const blockers = blockingStructuralFindings(validateDeliveryReadiness(result.workspace));
      if (blockers.length) throw new WorkbenchError("The Work Package relationships are invalid.", 409, "VALIDATION_BLOCKERS", { blockers });
      return { status: result.created ? 201 : 200, body: result.workspace };
    });
  }

  saveDeliverable(commandId, featureId, deliverableId, input) {
    if (input.targetReleaseTrainId) throw new WorkbenchError("Release Train assignment is unavailable in Phase 2.", 400, "RELEASE_ASSIGNMENT_OUT_OF_SCOPE");
    return this.#run(commandId, deliverableId ? "update-deliverable" : "create-deliverable", { featureId, deliverableId, ...input }, async (tx) => {
      const feature = await tx.lockFeature(featureId);
      assertExpectedVersion(feature.version, input.expectedFeatureVersion, "Feature");
      const workspace = await tx.readWorkspace(featureId);
      assertExpectedVersion(workspace.phaseStates["Delivery Readiness"].version, input.expectedPhaseVersion, "Delivery Readiness");
      assertEditablePhase(workspace.phaseStates["Delivery Readiness"].reviewState);
      const result = await tx.saveDeliverable({
        deliverableId,
        featureId,
        expectedVersion: input.expectedVersion,
        expectedPhaseVersion: input.expectedPhaseVersion,
        name: required(input.name, "Deliverable name"),
        description: input.description.trim(),
        targetSystem: input.targetSystem.trim(),
        targetEnvironment: input.targetEnvironment.trim(),
        artifactRevisionLabel: input.artifactRevisionLabel.trim(),
        authorName: required(input.authorName, "Author name"),
        workPackageIds: trimmedList(input.workPackageIds),
        predecessorIds: trimmedList(input.predecessorIds),
        readinessConditions: input.readinessConditions.map((item) => ({ key: required(item.key, "Readiness condition key"), text: required(item.text, "Readiness condition text") })),
      });
      const blockers = blockingStructuralFindings(validateDeliveryReadiness(result.workspace));
      if (blockers.length) throw new WorkbenchError("The Deliverable relationships are invalid.", 409, "VALIDATION_BLOCKERS", { blockers });
      return { status: result.created ? 201 : 200, body: result.workspace };
    });
  }

  validatePhase(commandId, featureId, phase, input) {
    return this.#run(commandId, `validate-${phase.toLocaleLowerCase().replaceAll(" ", "-")}`, { featureId, phase, ...input }, async (tx) => {
      const feature = await tx.lockFeature(featureId);
      assertExpectedVersion(feature.version, input.expectedFeatureVersion, "Feature");
      const workspace = await tx.readWorkspace(featureId);
      const findings = phase === "Delivery Readiness" ? validateDeliveryReadiness(workspace) : validateArtifact(phase, workspace);
      const validation = phase === "Delivery Readiness"
        ? await tx.saveReadinessValidation({ featureId, featureVersion: feature.version, findings })
        : await tx.saveArtifactValidation({ featureId, phase, featureVersion: feature.version, revisionId: currentRevision(workspace, phase)?.id ?? null, findings });
      return { status: 201, body: validation };
    });
  }

  requestReview(commandId, featureId, phase, input) {
    return this.#run(commandId, `request-${phase.toLocaleLowerCase().replaceAll(" ", "-")}-review`, { featureId, phase, ...input }, async (tx) => {
      const feature = await tx.lockFeature(featureId);
      assertExpectedVersion(feature.version, input.expectedFeatureVersion, "Feature");
      const workspace = await tx.readWorkspace(featureId);
      const state = workspace.phaseStates[phase];
      assertExpectedVersion(state.version, input.expectedPhaseVersion, phase);
      assertPhaseTransition(state.reviewState, "In Review");
      const findings = phase === "Delivery Readiness" ? validateDeliveryReadiness(workspace) : validateArtifact(phase, workspace);
      assertReviewable(findings);
      if (phase === "Delivery Readiness") await tx.saveReadinessValidation({ featureId, featureVersion: feature.version, findings });
      else await tx.saveArtifactValidation({ featureId, phase, featureVersion: feature.version, revisionId: currentRevision(workspace, phase)?.id ?? null, findings });
      const phaseState = await tx.setPhaseState({ featureId, phase, expectedVersion: input.expectedPhaseVersion, toState: "In Review", actorName: required(input.actorName, "Actor name"), rationale: required(input.rationale, "Review rationale") });
      return { body: { phaseState, findings } };
    });
  }

  requestChanges(commandId, featureId, phase, input) {
    return this.#run(commandId, `request-${phase.toLocaleLowerCase().replaceAll(" ", "-")}-changes`, { featureId, phase, ...input }, async (tx) => {
      const feature = await tx.lockFeature(featureId);
      assertExpectedVersion(feature.version, input.expectedFeatureVersion, "Feature");
      const workspace = await tx.readWorkspace(featureId);
      const state = workspace.phaseStates[phase];
      assertExpectedVersion(state.version, input.expectedPhaseVersion, phase);
      assertPhaseTransition(state.reviewState, "Changes Requested");
      const phaseState = await tx.setPhaseState({ featureId, phase, expectedVersion: input.expectedPhaseVersion, toState: "Changes Requested", actorName: required(input.actorName, "Actor name"), rationale: required(input.rationale, "Change rationale") });
      return { body: { phaseState } };
    });
  }

  approve(commandId, featureId, phase, input) {
    return this.#run(commandId, `approve-${phase.toLocaleLowerCase().replaceAll(" ", "-")}`, { featureId, phase, ...input }, async (tx) => {
      const feature = await tx.lockFeature(featureId);
      assertExpectedVersion(feature.version, input.expectedFeatureVersion, "Feature");
      const workspace = await tx.readWorkspace(featureId);
      const state = workspace.phaseStates[phase];
      assertExpectedVersion(state.version, input.expectedPhaseVersion, phase);
      const findings = phase === "Delivery Readiness" ? validateDeliveryReadiness(workspace) : validateArtifact(phase, workspace);
      assertApprovable(state.reviewState, findings, input.warningRationale);
      const actorName = required(input.actorName, "Actor name");
      const rationale = required(input.rationale, "Approval rationale");
      if (phase === "Delivery Readiness") {
        const validation = await tx.saveReadinessValidation({ featureId, featureVersion: feature.version, findings });
        const approved = await tx.approveReadiness({ workspace, expectedVersion: input.expectedPhaseVersion, validationRunId: validation.id, actorName, rationale, warningRationale: (input.warningRationale ?? "").trim() });
        return { status: 201, body: approved };
      }
      const revision = currentRevision(workspace, phase);
      if (!revision) throw new WorkbenchError(`${phase} has no current revision to approve.`, 409, "REVISION_MISSING");
      const validation = await tx.saveArtifactValidation({ featureId, phase, featureVersion: feature.version, revisionId: revision.id, findings });
      const approved = await tx.approveArtifact({ featureId, phase, expectedVersion: input.expectedPhaseVersion, revisionId: revision.id, validationRunId: validation.id, actorName, rationale, warningRationale: (input.warningRationale ?? "").trim() });
      return { status: 201, body: approved };
    });
  }
}

export function isArtifactPhase(phase) {
  return ARTIFACT_PHASES.includes(phase);
}
