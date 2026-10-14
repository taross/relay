export type Id<T extends string> = string & { readonly __type: T };

export type Team = {
  id: Id<"Team">;
  name: string;
  lead: string;
  memberCount: number;
};

export type ComponentKind = "ios" | "android" | "backend" | "admin";

export type Component = {
  id: Id<"Component">;
  name: string;
  kind: ComponentKind;
  ownerTeamId: Team["id"];
  repository: string;
  repositoryUrl?: string;
  defaultBranch?: string;
  githubConnection?: "mock" | "connected" | "disconnected";
  deliveryMethod: string;
};

export type GitHubPullRequest = {
  componentId: Component["id"];
  repository: string;
  number: number;
  title: string;
  body: string;
  author: string;
  state: "draft" | "review" | "merged";
  revision: string;
  baseBranch: string;
  labels: string[];
  changedFiles: string[];
  additions: number;
  deletions: number;
  updatedAt: string;
};

export type PullRequest = {
  repository: string;
  number: number;
  revision: string;
  state: "draft" | "review" | "merged";
  title?: string;
  description?: string;
  author?: string;
  url?: string;
  labels?: string[];
  changedFiles?: string[];
  additions?: number;
  deletions?: number;
};

export type MigrationPlan = {
  required: boolean;
  phase?: "expand" | "migrate" | "contract";
  execution?: "online" | "blocking";
  backwardCompatible?: boolean;
  estimatedMinutes?: number;
};

export type MaintenanceRequirement = "none" | "maintenance-mode" | "service-stop" | "undetermined";

export type VersionTransition = {
  currentVersion: string;
  targetVersion: string;
  versionSource?: "manual" | "github" | "deployment" | "app-store" | "google-play";
  rollout: "immediate" | "phased" | "store-phased";
  startsAt: string;
  expectedCompletionAt: string;
  coexistence: "compatible" | "feature-flag" | "incompatible";
  adoptionMilestones: { at: string; percentage: number }[];
};

export type ComponentReleasePlan = VersionTransition & {
  componentId: Component["id"];
};

export type ComponentChange = {
  id: Id<"ComponentChange">;
  componentId: Component["id"];
  ownerTeamId: Team["id"];
  summary: string;
  pullRequests: PullRequest[];
  migration: MigrationPlan;
  maintenance: MaintenanceRequirement;
  dependencyIds: ComponentChange["id"][];
  deploymentWindow: string;
  recovery: string;
  versionTransition?: VersionTransition;
};

export type Verification = {
  id: Id<"Verification">;
  releaseId: Id<"Release">;
  componentChangeId: ComponentChange["id"];
  name: string;
  condition: string;
  ownerTeamId: Team["id"];
  status: "pending" | "running" | "passed" | "failed";
  method?: string;
  successCriteria?: string;
  requiredEvidenceTypes?: VerificationEvidence["type"][];
  evidence?: VerificationEvidence[];
};

export type VerificationEvidence = {
  id: Id<"VerificationEvidence">;
  type: "unit" | "integration" | "e2e" | "contract" | "migration" | "build" | "security" | "manual";
  source: "github-actions" | "github-release" | "manual";
  repository: string;
  revision: string;
  name: string;
  result: "passed" | "failed";
  observedAt: string;
  expiresAt?: string;
  url?: string;
};

export type ReleaseChangelog = {
  id: Id<"ReleaseChangelog">;
  componentChangeId: ComponentChange["id"];
  source: "github-release" | "manual";
  summary: string;
  impact: string;
  compatibility: string;
  expectedVerification: string;
  author: string;
  recordedAt: string;
};

export type VerificationReview = {
  verdict: "adequate" | "needs-review";
  confidence: number;
  evaluatedAt: string;
  provider?: { id?: string; model?: string; usage?: unknown };
};


export type FeatureChange = {
  id: Id<"FeatureChange">;
  name: string;
  description: string;
  componentChanges: ComponentChange[];
};

export type ReleaseStatus = "draft" | "preparing" | "ready" | "running" | "completed";
export type ApprovalStatus = "not-requested" | "pending" | "approved" | "conditionally-approved" | "rejected" | "invalidated";

export type ReleasePlanningPolicy = {
  priority: "balanced" | "deadline" | "compatibility" | "continuity" | "coordination";
  objective: string;
  deadline?: string;
  requireBackwardCompatibility: boolean;
  allowSplit: boolean;
};

export type PlanCandidate = {
  id: string;
  name: string;
  strategy: "fastest" | "staged" | "compatibility-first" | "split" | "maintenance";
  summary: string;
  estimatedCompletionAt: string;
  deterministicRisk: number;
  steps: string[];
  constraints: string[];
  rationale: string[];
  tradeoffs: string[];
  metrics: {
    durationHours: number;
    compatibilityRisk: number;
    recoveryRisk: number;
    coordinationCost: number;
    objectiveFit: number;
  };
  /** Legacy localStorage compatibility. */
  conditions?: string[];
};

export type JevPlanEvaluation = {
  recommendation: "accept" | "accept-with-conditions" | "revise" | "reject";
  selectedPlanId: string;
  riskScore: number;
  confidence: number;
  categories: {
    compatibility: number;
    rollout: number;
    recovery: number;
    verification: number;
    schedule: number;
  };
  commitments: string[];
  /** Legacy localStorage compatibility. */
  conditions?: string[];
  evaluatedAt: string;
  mock: boolean;
  provider?: {
    id?: string;
    model?: string;
    usage?: unknown;
  };
};

export type ReleasePlanDecision = {
  graphRevision: string;
  generatedAt: string;
  candidates: PlanCandidate[];
  excludedCandidates?: { name: string; reason: string }[];
  selectedPlanId: string;
  evaluation?: JevPlanEvaluation;
};

export type RepositoryReadme = {
  componentId: Component["id"];
  repository: string;
  path: string;
  revision: string;
  summary: string;
  commands: { purpose: string; command: string }[];
  cautions: string[];
};

export type RunbookStep = {
  id: string;
  order: number;
  phase: "precheck" | "migration" | "deploy" | "verify" | "rollout" | "close";
  componentId?: Component["id"];
  title: string;
  instruction: string;
  command?: string;
  expectedResult: string;
  stopCondition?: string;
  recovery?: string;
  sourceRefs: string[];
};

export type ReleaseRunbook = {
  graphRevision: string;
  planId: string;
  generatedAt: string;
  mock: boolean;
  sourceDocuments: { repository: string; path: string; revision: string }[];
  steps: RunbookStep[];
};

export type ReleaseHistoryEntry = {
  id: Id<"ReleaseHistoryEntry">;
  type: "schedule" | "approval" | "note" | "plan" | "jev" | "runbook" | "verification" | "change-event";
  occurredAt: string;
  actor: string;
  summary: string;
  detail?: string;
};

export type ReleaseUnitMode = "include" | "disable" | "exclude" | "fix-and-revalidate" | "defer";

export type ConstraintScope =
  | { type: "release"; id: Id<"Release"> }
  | { type: "release-unit"; id: Id<"FeatureChange"> }
  | { type: "component-change"; id: Id<"ComponentChange"> }
  | { type: "verification"; id: Id<"Verification"> }
  | { type: "activity"; id: Id<"Activity"> };

export type ReleaseConstraint = {
  id: Id<"ReleaseConstraint">;
  scope: ConstraintScope;
  kind: "dependency" | "compatibility" | "evidence" | "approval" | "resource" | "schedule" | "policy" | "external";
  hardness: "hard" | "soft";
  source: "policy" | "team-input" | "github" | "jev-suggestion" | "system-derived";
  ownerTeamId?: Team["id"];
  certainty: "unknown" | "assumed" | "confirmed" | "stale" | "conflicting";
  requiredEvidenceTypes?: VerificationEvidence["type"][];
  appliesWhen?: string;
  validFrom?: string;
  validUntil?: string;
  statement: string;
};

export type ConstraintEvaluation = {
  constraintId: ReleaseConstraint["id"];
  result: "not-evaluated" | "satisfied" | "violated" | "unknown";
  severity: "info" | "warning" | "blocker";
  explanation: string;
  requiredAction?: string;
  evaluatedAt: string;
};

export type Resource = {
  id: Id<"Resource">;
  name: string;
  kind: "person" | "team-capacity" | "environment" | "device" | "external-review";
  ownerTeamId?: Team["id"];
  capacity: number;
};

export type ResourceCalendarWindow = {
  id: Id<"ResourceCalendarWindow">;
  resourceId: Resource["id"];
  activityId?: Id<"Activity">;
  label: string;
  start: string;
  end: string;
  capacityUsed: number;
  fixed: boolean;
};

export type Activity = {
  id: Id<"Activity">;
  releaseId: Id<"Release">;
  kind: "change" | "migration" | "deploy" | "store-review" | "feature-flag" | "verification" | "approval" | "wait";
  subjectId: string;
  ownerTeamId: Team["id"];
  durationMinutes: number;
  status: "not-started" | "ready" | "running" | "done" | "blocked" | "cancelled";
  schedule?: {
    earliestStart?: string;
    expectedStart?: string;
    latestEnd?: string;
    displayOrder?: number;
  };
  mode?: ReleaseUnitMode;
};

export type ChangeEvent = {
  id: Id<"ChangeEvent">;
  releaseUnitId?: FeatureChange["id"];
  componentChangeId?: ComponentChange["id"];
  kind: "bug" | "delay" | "approval-wait" | "environment-failure" | "scope-change";
  summary: string;
  occurredAt: string;
  reportedBy: string;
  status: "open" | "accepted" | "dismissed";
  selectedMode?: ReleaseUnitMode;
};

export type PlanVersion = {
  id: Id<"PlanVersion">;
  releaseId: Id<"Release">;
  sequence: number;
  graphRevision: string;
  status: "draft" | "candidate" | "approved" | "superseded";
  createdAt: string;
  basedOnVersionId?: Id<"PlanVersion">;
  changeSummary: string;
};

export type ResourceConflict = {
  resourceId: Resource["id"];
  windowIds: ResourceCalendarWindow["id"][];
  requiredCapacity: number;
  availableCapacity: number;
  explanation: string;
};

export type SuggestedAction = {
  id: string;
  label: string;
  description: string;
  impact: string;
};

export type ReleaseReadModel = {
  releaseId: Id<"Release">;
  status: "ready" | "blocked" | "unknown";
  blockedConditions: ConstraintEvaluation[];
  unknownConditions: ConstraintEvaluation[];
  satisfiedConditions: ConstraintEvaluation[];
  resourceConflicts: ResourceConflict[];
  suggestedActions: SuggestedAction[];
  approvalInvalidated: boolean;
  evaluatedAt: string;
};

export type ChangeIntent = {
  id: Id<"ChangeIntent">;
  title: string;
  description: string;
  reason: string;
  expectedBehavior: string;
  issueRefs: string[];
  requirementRefs: string[];
  affectedAreas: string[];
  author: string;
  teamId: Team["id"];
  componentChangeIds: ComponentChange["id"][];
};

export type ReleaseCandidateArtifact = {
  componentId: Component["id"];
  repository: string;
  kind: "commit" | "ios-build" | "android-build" | "artifact";
  revision: string;
  version?: string;
};

export type ReleaseCandidateManifest = {
  id: Id<"ReleaseCandidateManifest">;
  sequence: number;
  status: "draft" | "frozen" | "superseded";
  artifacts: ReleaseCandidateArtifact[];
  createdAt: string;
  frozenAt?: string;
};

export type IntelligenceEvidence = {
  id: Id<"IntelligenceEvidence">;
  type: "changed-files" | "migration" | "dependency" | "test-result" | "rc-artifact";
  subjectId: string;
  summary: string;
  details: string[];
  source: string;
  observedAt: string;
};

export type RiskFinding = {
  id: string;
  level: "low" | "medium" | "high" | "critical";
  reason: string;
  confidence: number;
  evidenceIds: IntelligenceEvidence["id"][];
};

export type SelectedTest = {
  id: string;
  name: string;
  category: "smoke" | "critical-journey" | "functional" | "regression" | "incident-regression" | "contract" | "model" | "resilience";
  level: "unit" | "domain" | "api" | "contract" | "integration" | "mobile-ui" | "system-e2e";
  required: boolean;
  reason: string;
  evidenceIds: IntelligenceEvidence["id"][];
};

export type TestGapProposal = {
  id: string;
  property: string;
  currentCoverage: string;
  suggestedLevel: SelectedTest["level"];
  suggestedTestName: string;
  reason: string;
  status: "proposed" | "accepted";
  evidenceIds: IntelligenceEvidence["id"][];
};

export type TestCaseProposal = {
  id: string;
  name: string;
  category: SelectedTest["category"];
  level: SelectedTest["level"];
  targetComponents: Component["id"][];
  given: string[];
  when: string[];
  then: string[];
  reason: string;
  status: "proposed" | "accepted";
  evidenceIds: IntelligenceEvidence["id"][];
  executable: {
    fixture: Record<string, unknown>;
    steps: {
      driver: "backend" | "database" | "ios" | "android" | "admin";
      command: string;
      input: Record<string, unknown>;
      assertions: { actualPath: string; operator: "equals" | "contains" | "count" | "schema"; expected: unknown }[];
    }[];
  };
  lastRun?: {
    id: string;
    result: "passed" | "failed";
    executedAt: string;
    assertions: { label: string; passed: boolean; actual: unknown; expected: unknown }[];
  };
};

export type ReleaseGateDecision = {
  result: "unknown" | "blocked" | "approval-required" | "ready";
  reasons: string[];
  evaluatedAt: string;
  manifestId?: ReleaseCandidateManifest["id"];
};

export type ReleaseIntelligence = {
  analysisRevision: string;
  analyzedAt: string;
  evidence: IntelligenceEvidence[];
  risks: RiskFinding[];
  selectedTests: SelectedTest[];
  testCaseProposals: TestCaseProposal[];
  testGapProposals: TestGapProposal[];
  gate: ReleaseGateDecision;
};

export type Release = {
  id: Id<"Release">;
  code: string;
  name: string;
  status: ReleaseStatus;
  ownerTeamId: Team["id"];
  scheduledFor: string;
  scheduledAt?: string;
  approvalStatus?: ApprovalStatus;
  approvedBy?: string;
  approvedPlanRevision?: string;
  considerations?: string;
  notes?: string;
  history?: ReleaseHistoryEntry[];
  featureChanges: FeatureChange[];
  verifications: Verification[];
  changelogs?: ReleaseChangelog[];
  verificationReview?: VerificationReview;
  componentPlans?: ComponentReleasePlan[];
  planDecision?: ReleasePlanDecision;
  planningPolicy?: ReleasePlanningPolicy;
  runbook?: ReleaseRunbook;
  cutoffAt?: string;
  changeIntents?: ChangeIntent[];
  rcManifests?: ReleaseCandidateManifest[];
  intelligence?: ReleaseIntelligence;
  constraints?: ReleaseConstraint[];
  activities?: Activity[];
  resources?: Resource[];
  resourceCalendar?: ResourceCalendarWindow[];
  changeEvents?: ChangeEvent[];
  planVersions?: PlanVersion[];
};

export const id = <T extends string>(value: string) => value as Id<T>;
