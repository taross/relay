export type ReviewState = "Not Started" | "Draft" | "In Review" | "Changes Requested" | "Approved" | "Superseded";
export type BaselineValidity = "Not Evaluated" | "Current" | "Impacted" | "Invalid";
export type CandidateStatus = "Pending" | "Accepted" | "Rejected";
export type FindingSeverity = "Blocker" | "Warning" | "Info";

export type Product = {
  id: string;
  name: string;
  description: string;
  version: number;
  featureCount: number;
  createdAt: string;
  updatedAt: string;
};

export type Feature = {
  id: string;
  productId: string;
  name: string;
  summary: string;
  reviewState: ReviewState;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type ProductDetail = Product & { features: Feature[] };
export type RequirementSource = { id: string; featureId: string; content: string; provenance: "Manual" | "Deterministic Sample"; createdAt: string };
export type RequirementCandidate = {
  id: string;
  featureId: string;
  sourceId: string;
  externalKey: string;
  title: string;
  text: string;
  status: CandidateStatus;
  decisionRationale: string;
  acceptedRequirementId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};
export type RequirementConflict = { targetExternalKey: string; resolved: boolean };
export type RequirementRevision = {
  id: string;
  requirementId: string;
  externalKey: string;
  revisionNumber: number;
  title: string;
  text: string;
  state: "Draft" | "Approved" | "Superseded";
  predecessorRevisionId: string | null;
  version: number;
  referenceKeys: string[];
  conflicts: RequirementConflict[];
  createdAt: string;
};
export type ValidationFinding = { id?: string; severity: FindingSeverity; code: string; message: string; requirementRevisionId: string | null };
export type ValidationRun = { id: string; featureVersion: number; validatorVersion: string; createdAt: string; findings: ValidationFinding[] };
export type RequirementBaseline = {
  id: string;
  baselineNumber: number;
  validity: BaselineValidity;
  revisionCount: number;
  createdAt: string;
  approval: { id: string; actorName: string; rationale: string; warningRationale: string | null; createdAt: string };
};
export type FeatureWorkspace = {
  product: { id: string; name: string; version: number };
  feature: Feature;
  sources: RequirementSource[];
  candidates: RequirementCandidate[];
  requirements: RequirementRevision[];
  latestValidation: ValidationRun | null;
  baselines: RequirementBaseline[];
};

export type ArtifactPhase = "Specification" | "Solution Design" | "Verification Planning";
export type FeaturePhase = "Requirements" | ArtifactPhase | "Delivery Readiness";
export type PhaseState = { reviewState: ReviewState; version: number; updatedAt: string | null };
export type TraceFinding = { id?: string; severity: FindingSeverity; code: string; message: string; entityType: string; entityId: string | null };
export type ArtifactValidation = { id: string; phase: ArtifactPhase; featureVersion: number; artifactRevisionId: string | null; validatorVersion: string; createdAt: string; findings: TraceFinding[] };
export type ReadinessValidation = { id: string; featureVersion: number; validatorVersion: string; createdAt: string; findings: TraceFinding[] };
export type AcceptanceCriterion = { id: string; key: string; text: string; requirementRevisionIds: string[] };
export type SpecificationRevision = { id: string; revisionNumber: number; title: string; behavior: string; state: "Draft" | "Approved" | "Superseded"; predecessorRevisionId: string | null; authorName: string; version: number; criteria: AcceptanceCriterion[]; requirementRevisionIds: string[]; createdAt: string; updatedAt: string };
export type DesignRevision = { id: string; revisionNumber: number; title: string; summary: string; state: "Draft" | "Approved" | "Superseded"; predecessorRevisionId: string | null; authorName: string; version: number; specificationRevisionIds: string[]; requirementRevisionIds: string[]; acceptanceCriterionIds: string[]; createdAt: string; updatedAt: string };
export type VerificationCase = { id: string; key: string; method: string; successCriteria: string; executionCondition: string; responsibleTeam: string; specificationRevisionIds: string[]; requirementRevisionIds: string[]; acceptanceCriterionIds: string[] };
export type VerificationPlanRevision = { id: string; revisionNumber: number; title: string; state: "Draft" | "Approved" | "Superseded"; predecessorRevisionId: string | null; authorName: string; version: number; cases: VerificationCase[]; createdAt: string; updatedAt: string };
export type WorkPackage = { id: string; key: string; type: "development" | "QA" | "other"; description: string; owningTeam: string; version: number; predecessorIds: string[]; designRevisionIds: string[]; verificationRevisionIds: string[]; createdAt: string; updatedAt: string };
export type DeliverableRevision = { id: string; deliverableId: string; revisionNumber: number; name: string; description: string; targetSystem: string; targetEnvironment: string; artifactRevisionLabel: string; targetReleaseTrainId: null; state: "Draft" | "Approved" | "Superseded"; predecessorRevisionId: string | null; authorName: string; version: number; readinessConditions: { key: string; text: string }[]; workPackageIds: string[]; predecessorIds: string[]; approval: { id: string; actorName: string; rationale: string; createdAt: string } | null; createdAt: string; updatedAt: string };
export type ArtifactBaseline = { id: string; phase: ArtifactPhase; baselineNumber: number; revisionId: string; validationRunId: string; validity: BaselineValidity; createdAt: string; approval: { actorName: string; rationale: string; warningRationale: string; createdAt: string } };
export type ReadinessBaseline = { id: string; baselineNumber: number; requirementBaselineId: string; specificationRevisionId: string; designRevisionId: string; verificationRevisionId: string; validationRunId: string; validity: BaselineValidity; createdAt: string; approval: { actorName: string; rationale: string; warningRationale: string; createdAt: string } };
export type Phase2Workspace = {
  product: { id: string; name: string; version: number };
  feature: Feature;
  phaseStates: Record<FeaturePhase, PhaseState>;
  requirements: { id: string; requirementId: string; externalKey: string; title: string; text: string; state: "Approved"; version: number }[];
  specification: SpecificationRevision | null;
  design: DesignRevision | null;
  verificationPlan: VerificationPlanRevision | null;
  workPackages: WorkPackage[];
  deliverables: DeliverableRevision[];
  artifactBaselines: ArtifactBaseline[];
  readinessBaselines: ReadinessBaseline[];
  latestValidations: Partial<Record<ArtifactPhase, ArtifactValidation>>;
  latestReadinessValidation: ReadinessValidation | null;
};

export type ApiErrorBody = { error?: string; code?: string; details?: { currentVersion?: number } };
