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

export type PlanningRuleLevel = "mandatory" | "configurable" | "advisory";
export type PlanningFindingStatus = "violated" | "unknown";
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type PlanningPolicyRule = { id: string; level: PlanningRuleLevel; kind: string; ruleVersion: string; parameters: { [key: string]: JsonValue } };
export type PlanningPolicyRevision = { id: string; productId: string; revisionNumber: number; predecessorRevisionId: string | null; rules: PlanningPolicyRule[]; createdAt: string };
export type PlanningDelivery = { id: string; productId: string; name: string; version: number; createdAt: string; updatedAt: string };
export type PlanningCapacity = { effectiveFrom: string; effectiveTo: string | null; units: number };
export type PlanningResource = { id: string; productId: string; name: string; version: number; capacity: PlanningCapacity[]; createdAt: string; updatedAt: string };
export type PlanningTrain = { id: string; productId: string; name: string; cutoffAt: string | null; version: number; createdAt: string; updatedAt: string };
export type PlanningDemand = { resourceId: string; units: number };
export type PlanningActivity = { id: string; productId: string; name: string; startAt: string; endAt: string; predecessorIds: string[]; demands: PlanningDemand[] };
export type PlanningDeliverable = { id: string; productId: string; name: string; order: number; predecessorIds: string[]; trainId: string | null; readyAt: string | null };
export type PlanningConstraint = { id: string; level: PlanningRuleLevel; kind: string; ruleVersion: string; requiresEvidence: boolean; evidence: JsonValue; override: boolean; overrideRationale: string | null };
export type PlanningScenarioRevision = { id: string; scenarioId: string; productId: string; deliveryId: string; revisionNumber: number; predecessorRevisionId: string | null; provenance: "manual"; inputHash: string; activities: PlanningActivity[]; deliverables: PlanningDeliverable[]; constraints: PlanningConstraint[]; createdAt: string };
export type PlanningScenario = { id: string; productId: string; deliveryId: string; name: string; provenance: "manual"; clonedFromRevisionId?: string; version: number; revisions: PlanningScenarioRevision[]; createdAt: string; updatedAt: string };
export type PlanningActual = { id: string; productId: string; scenarioId: string; activityId: string; kind: string; value: JsonValue; observedAt: string; recordedAt: string };
export type PlanningFinding = { id: string; status: PlanningFindingStatus; code: string; message: string; entityType: string; entityId: string | null; details: { [key: string]: JsonValue } };
export type PlanningValidation = { id: string; productId: string; scenarioId: string; revisionId: string; asOf: string; validatorSetVersion: string; inputHash: string; status: "blocked" | "verified"; findings: PlanningFinding[]; createdAt: string };
export type PlanningWorkspace = { product: { id: string; name: string; version: number }; deliveries: PlanningDelivery[]; deliverables: PlanningDeliverable[]; policies: PlanningPolicyRevision[]; resources: PlanningResource[]; trains: PlanningTrain[]; scenarios: PlanningScenario[]; actuals: PlanningActual[]; validations: PlanningValidation[] };
export type PlanningFieldDifference = { field: string; before: JsonValue; after: JsonValue };
export type PlanningCollectionDifference = { collection: "activities" | "deliverables" | "constraints"; entityId: string; change: "added" | "removed" | "changed"; fields: PlanningFieldDifference[] };
export type PlanningRevisionComparison = { productId: string; beforeRevisionId: string; afterRevisionId: string; beforeInputHash: string; afterInputHash: string; equal: boolean; fields: PlanningFieldDifference[]; collections: PlanningCollectionDifference[] };

export type ApiErrorBody = { error?: string; code?: string; details?: { currentVersion?: number } };
