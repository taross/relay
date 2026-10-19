import { WorkbenchError } from "./domain.mjs";

export const FEATURE_PHASES = ["Specification", "Solution Design", "Verification Planning", "Delivery Readiness"];
export const ARTIFACT_PHASES = FEATURE_PHASES.slice(0, 3);
export const REVIEW_STATES = ["Not Started", "Draft", "In Review", "Changes Requested", "Approved", "Superseded"];

const transitions = new Map([
  ["Not Started", ["Draft"]],
  ["Draft", ["In Review"]],
  ["In Review", ["Changes Requested", "Approved"]],
  ["Changes Requested", ["Draft", "In Review"]],
  ["Approved", ["Draft", "Superseded"]],
  ["Superseded", []],
]);

export function assertExpectedVersion(actual, expected, resourceName) {
  if (!Number.isInteger(expected) || expected < 1) throw new WorkbenchError("An explicit expected version is required.", 400, "INVALID_VERSION");
  if (actual !== expected) throw new WorkbenchError(`${resourceName} changed since it was loaded. Reload and retry.`, 409, "STALE_VERSION", { expected, actual });
}

export function assertPhaseTransition(current, next) {
  if (!transitions.get(current)?.includes(next)) {
    throw new WorkbenchError(`The ${current} → ${next} review transition is not allowed.`, 409, "INVALID_REVIEW_TRANSITION");
  }
}

export function assertEditablePhase(state) {
  if (state === "In Review") throw new WorkbenchError("Request changes before editing an artifact that is in review.", 409, "REVIEW_LOCKED");
  if (state === "Superseded") throw new WorkbenchError("A superseded phase cannot be edited.", 409, "IMMUTABLE_PHASE");
}

const finding = (severity, code, message, entityType, entityId = null) => ({ severity, code, message, entityType, entityId });

function duplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    const key = value.trim().toLocaleLowerCase();
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
  }
  return duplicates;
}

export function validateArtifact(phase, workspace) {
  const findings = [];
  const requirements = workspace.requirements.filter((item) => item.state === "Approved");
  const specification = workspace.specification;
  const design = workspace.design;
  const verification = workspace.verificationPlan;

  if (phase === "Specification") {
    if (!specification) return [finding("Blocker", "SPECIFICATION_MISSING", "The Feature must have a Specification revision before review.", "Feature", workspace.feature.id)];
    if (!specification.title.trim()) findings.push(finding("Blocker", "SPECIFICATION_TITLE_MISSING", "The Specification revision must have a title before review.", "SpecificationRevision", specification.id));
    if (!specification.behavior.trim()) findings.push(finding("Blocker", "SPECIFICATION_BEHAVIOR_MISSING", "The Specification revision must describe expected behavior before review.", "SpecificationRevision", specification.id));
    if (specification.criteria.length === 0) findings.push(finding("Blocker", "ACCEPTANCE_CRITERIA_MISSING", "The Specification revision must include at least one acceptance criterion before review.", "SpecificationRevision", specification.id));
    for (const key of duplicateValues(specification.criteria.map((item) => item.key))) findings.push(finding("Blocker", "DUPLICATE_ACCEPTANCE_KEY", `Acceptance criterion key “${key}” is duplicated.`, "SpecificationRevision", specification.id));
    const linked = new Set(specification.requirementRevisionIds);
    for (const requirement of requirements) if (!linked.has(requirement.id)) findings.push(finding("Blocker", "REQUIREMENT_NOT_SPECIFIED", `Approved Requirement ${requirement.externalKey} is not traced to the Specification revision.`, "RequirementRevision", requirement.id));
    for (const id of linked) if (!requirements.some((item) => item.id === id)) findings.push(finding("Blocker", "INVALID_REQUIREMENT_TRACE", "The Specification contains a trace to a missing or unapproved Requirement revision.", "RequirementRevision", id));
    for (const criterion of specification.criteria) {
      if (!criterion.requirementRevisionIds.length) findings.push(finding("Blocker", "CRITERION_REQUIREMENT_TRACE_MISSING", `Acceptance criterion ${criterion.key} must trace to at least one approved Requirement revision.`, "AcceptanceCriterion", criterion.id));
      for (const id of criterion.requirementRevisionIds) if (!requirements.some((item) => item.id === id)) findings.push(finding("Blocker", "INVALID_CRITERION_REQUIREMENT_TRACE", `Acceptance criterion ${criterion.key} contains a trace to a missing or unapproved Requirement revision.`, "AcceptanceCriterion", criterion.id));
    }
  }

  if (phase === "Solution Design") {
    if (!design) return [finding("Blocker", "DESIGN_MISSING", "The Feature must have a Solution Design revision before review.", "Feature", workspace.feature.id)];
    if (!design.title.trim()) findings.push(finding("Blocker", "DESIGN_TITLE_MISSING", "The Solution Design revision must have a title before review.", "DesignRevision", design.id));
    if (!design.summary.trim()) findings.push(finding("Blocker", "DESIGN_SUMMARY_MISSING", "The Solution Design revision must describe the implementation approach before review.", "DesignRevision", design.id));
    if (!specification || specification.state !== "Approved") findings.push(finding("Blocker", "SPECIFICATION_NOT_APPROVED", "The Specification phase must be approved before Solution Design approval.", "Feature", workspace.feature.id));
    if (specification && !design.specificationRevisionIds.includes(specification.id)) findings.push(finding("Blocker", "SPECIFICATION_NOT_TRACED", "The Solution Design revision must trace to the current approved Specification revision.", "SpecificationRevision", specification.id));
    const linked = new Set(design.requirementRevisionIds);
    for (const requirement of requirements) if (!linked.has(requirement.id)) findings.push(finding("Blocker", "REQUIREMENT_NOT_DESIGNED", `Approved Requirement ${requirement.externalKey} is not traced to the Solution Design revision.`, "RequirementRevision", requirement.id));
    const criterionIds = new Set(specification?.criteria.map((item) => item.id) ?? []);
    const designedCriteria = new Set(design.acceptanceCriterionIds);
    for (const criterion of specification?.criteria ?? []) if (!designedCriteria.has(criterion.id)) findings.push(finding("Blocker", "CRITERION_NOT_DESIGNED", `Acceptance criterion ${criterion.key} is not traced to the Solution Design revision.`, "AcceptanceCriterion", criterion.id));
    for (const id of designedCriteria) if (!criterionIds.has(id)) findings.push(finding("Blocker", "INVALID_DESIGN_CRITERION_TRACE", "The Solution Design contains a trace to a missing or superseded Acceptance Criterion.", "AcceptanceCriterion", id));
  }

  if (phase === "Verification Planning") {
    if (!verification) return [finding("Blocker", "VERIFICATION_PLAN_MISSING", "The Feature must have a Verification Plan revision before review.", "Feature", workspace.feature.id)];
    if (!verification.title.trim()) findings.push(finding("Blocker", "VERIFICATION_TITLE_MISSING", "The Verification Plan revision must have a title before review.", "VerificationPlanRevision", verification.id));
    if (!specification || specification.state !== "Approved") findings.push(finding("Blocker", "SPECIFICATION_NOT_APPROVED", "The Specification phase must be approved before Verification Planning approval.", "Feature", workspace.feature.id));
    if (verification.cases.length === 0) findings.push(finding("Blocker", "VERIFICATION_CASES_MISSING", "The Verification Plan revision must include at least one verification case before review.", "VerificationPlanRevision", verification.id));
    for (const key of duplicateValues(verification.cases.map((item) => item.key))) findings.push(finding("Blocker", "DUPLICATE_VERIFICATION_KEY", `Verification case key “${key}” is duplicated.`, "VerificationPlanRevision", verification.id));
    const coveredSpecifications = new Set(verification.cases.flatMap((item) => item.specificationRevisionIds));
    if (specification && !coveredSpecifications.has(specification.id)) findings.push(finding("Blocker", "SPECIFICATION_NOT_VERIFIED", "At least one verification case must trace to the current approved Specification revision.", "SpecificationRevision", specification.id));
    const currentCriterionIds = new Set(specification?.criteria.map((item) => item.id) ?? []);
    const coveredCriteria = new Set(verification.cases.flatMap((item) => item.acceptanceCriterionIds));
    for (const criterion of specification?.criteria ?? []) if (!coveredCriteria.has(criterion.id)) findings.push(finding("Blocker", "CRITERION_NOT_VERIFIED", `Acceptance criterion ${criterion.key} is not covered by a verification case.`, "AcceptanceCriterion", criterion.id));
    for (const id of coveredCriteria) if (!currentCriterionIds.has(id)) findings.push(finding("Blocker", "INVALID_VERIFICATION_CRITERION_TRACE", "A verification case traces to a missing or superseded Acceptance Criterion.", "AcceptanceCriterion", id));
    const coveredRequirements = new Set(verification.cases.flatMap((item) => item.requirementRevisionIds));
    for (const requirement of requirements) if (!coveredRequirements.has(requirement.id)) findings.push(finding("Blocker", "REQUIREMENT_NOT_VERIFIED", `Approved Requirement ${requirement.externalKey} is not covered by a verification case.`, "RequirementRevision", requirement.id));
    for (const item of verification.cases) {
      if (!item.method.trim() || !item.successCriteria.trim() || !item.executionCondition.trim() || !item.responsibleTeam.trim()) findings.push(finding("Blocker", "VERIFICATION_CASE_INCOMPLETE", `Verification case ${item.key} must define method, success criteria, execution condition, and responsible team.`, "VerificationCase", item.id));
    }
  }

  if (findings.length === 0) findings.push(finding("Info", "ARTIFACT_CONSISTENT", `The deterministic ${phase} checks passed.`, "Feature", workspace.feature.id));
  return findings;
}

function detectCycle(nodes, predecessorIds) {
  const visiting = new Set();
  const visited = new Set();
  const visit = (id) => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const predecessor of predecessorIds(id)) if (visit(predecessor)) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  return nodes.some((node) => visit(node.id));
}

export function validateDeliveryReadiness(workspace) {
  const findings = [];
  for (const phase of ["Requirements", "Specification", "Solution Design", "Verification Planning"]) {
    if (workspace.phaseStates[phase]?.reviewState !== "Approved") findings.push(finding("Blocker", "PHASE_NOT_APPROVED", `${phase} must be approved before Delivery Readiness approval.`, "Feature", workspace.feature.id));
  }
  if (workspace.workPackages.length === 0) findings.push(finding("Blocker", "WORK_PACKAGES_MISSING", "The Feature must include at least one Work Package before Delivery Readiness approval.", "Feature", workspace.feature.id));
  if (workspace.deliverables.length === 0) findings.push(finding("Blocker", "DELIVERABLES_MISSING", "The Feature must include at least one Deliverable before Delivery Readiness approval.", "Feature", workspace.feature.id));

  const packageIds = new Set(workspace.workPackages.map((item) => item.id));
  for (const item of workspace.workPackages) {
    if (!item.designRevisionIds.length) findings.push(finding("Blocker", "WORK_PACKAGE_DESIGN_TRACE_MISSING", `Work Package ${item.key} must trace to an approved Solution Design revision.`, "WorkPackage", item.id));
    if (!item.verificationRevisionIds.length) findings.push(finding("Blocker", "WORK_PACKAGE_VERIFICATION_TRACE_MISSING", `Work Package ${item.key} must trace to an approved Verification Plan revision.`, "WorkPackage", item.id));
    for (const predecessor of item.predecessorIds) if (!packageIds.has(predecessor)) findings.push(finding("Blocker", "WORK_PACKAGE_PREDECESSOR_MISSING", `Work Package ${item.key} references a missing predecessor.`, "WorkPackage", item.id));
  }
  if (detectCycle(workspace.workPackages, (id) => workspace.workPackages.find((item) => item.id === id)?.predecessorIds ?? [])) findings.push(finding("Blocker", "WORK_PACKAGE_CYCLE", "Work Package predecessor relationships must not contain a cycle.", "Feature", workspace.feature.id));

  const deliverableIds = new Set(workspace.deliverables.map((item) => item.deliverableId));
  for (const item of workspace.deliverables) {
    if (item.targetReleaseTrainId) findings.push(finding("Blocker", "RELEASE_ASSIGNMENT_OUT_OF_SCOPE", `Deliverable ${item.name} cannot reference a Release Train in Phase 2.`, "DeliverableRevision", item.id));
    if (!item.targetSystem.trim() || !item.targetEnvironment.trim() || !item.artifactRevisionLabel.trim()) findings.push(finding("Blocker", "DELIVERABLE_IDENTITY_INCOMPLETE", `Deliverable ${item.name} must define target system, environment, and artifact revision.`, "DeliverableRevision", item.id));
    if (!item.workPackageIds.length || item.workPackageIds.some((id) => !packageIds.has(id))) findings.push(finding("Blocker", "DELIVERABLE_WORK_PACKAGE_TRACE_INVALID", `Deliverable ${item.name} must trace to this Feature’s Work Packages.`, "DeliverableRevision", item.id));
    if (!item.readinessConditions.length) findings.push(finding("Blocker", "READINESS_CONDITIONS_MISSING", `Deliverable ${item.name} must define at least one readiness condition.`, "DeliverableRevision", item.id));
    for (const predecessor of item.predecessorIds) if (!deliverableIds.has(predecessor)) findings.push(finding("Blocker", "DELIVERABLE_PREDECESSOR_MISSING", `Deliverable ${item.name} references a missing predecessor.`, "DeliverableRevision", item.id));
  }
  if (detectCycle(workspace.deliverables.map((item) => ({ ...item, id: item.deliverableId })), (id) => workspace.deliverables.find((item) => item.deliverableId === id)?.predecessorIds ?? [])) findings.push(finding("Blocker", "DELIVERABLE_CYCLE", "Deliverable predecessor relationships must not contain a cycle.", "Feature", workspace.feature.id));
  if (findings.length === 0) findings.push(finding("Info", "DELIVERY_READINESS_CONSISTENT", "The deterministic Delivery Readiness checks passed. No execution was performed.", "Feature", workspace.feature.id));
  return findings;
}

export function assertReviewable(findings) {
  const blockers = findings.filter((item) => item.severity === "Blocker");
  if (blockers.length) throw new WorkbenchError("Resolve all deterministic blockers before requesting review.", 409, "VALIDATION_BLOCKERS", { blockers });
}

export function assertApprovable(state, findings, warningRationale) {
  if (state !== "In Review") throw new WorkbenchError("Only a phase that is In Review can be approved.", 409, "INVALID_REVIEW_TRANSITION");
  assertReviewable(findings);
  if (findings.some((item) => item.severity === "Warning") && !(warningRationale ?? "").trim()) throw new WorkbenchError("Approval with warnings requires an explicit rationale.", 409, "WARNING_RATIONALE_REQUIRED");
}
