import { useCallback, useEffect, useState, type ReactNode } from "react";
import { workbenchApi } from "./api";
import { DeliverableForm, DesignForm, PanelSection, PhaseDecisionForm, SpecificationForm, VerificationForm, WorkPackageForm } from "./Phase2Forms";
import type { ArtifactPhase, ArtifactValidation, FeaturePhase, Phase2Workspace as Workspace, ReadinessValidation, ReviewState, TraceFinding } from "./types";
import { FormError } from "./WorkbenchDialog";

const deliveryPhases: FeaturePhase[] = ["Requirements", "Specification", "Solution Design", "Verification Planning", "Delivery Readiness"];
function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "The request could not be completed.";
}

export function Phase2Workspace({ featureId, onChanged }: { featureId: string; onChanged: () => void }) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [phase, setPhase] = useState<FeaturePhase>("Specification");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<ReactNode>(null);
  const load = useCallback(() => {
    setError("");
    workbenchApi.getPhase2Workspace(featureId).then(setWorkspace).catch((reason: unknown) => setError(errorMessage(reason)));
  }, [featureId]);
  useEffect(load, [load]);

  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await operation();
      setDialog(null);
      load();
      onChanged();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  if (!workspace) return <section className="workbench-section" aria-labelledby="delivery-workflow-title"><h2 id="delivery-workflow-title">Delivery workflow</h2><FormError message={error} />{!error ? <p>Loading delivery workflow…</p> : null}</section>;
  const requirementsApproved = workspace.phaseStates.Requirements.reviewState === "Approved";

  return <section className="workbench-section phase2-workspace" aria-labelledby="delivery-workflow-title">
    <header><div><h2 id="delivery-workflow-title">Delivery workflow</h2><span>Feature artifacts and readiness</span></div></header>
    <p className="workbench-truth-note">Each phase has an independent Review State. Approved revision baselines remain immutable; Baseline Validity records whether later work has affected them. No Deployment, Release, or Activation is created here.</p>
    <FormError message={error} />
    <nav className="phase-nav" aria-label="Feature artifact phases">
      {deliveryPhases.map((item) => <button key={item} type="button" aria-current={phase === item ? "step" : undefined} onClick={() => setPhase(item)}>
        <span>{item}</span><b>{workspace.phaseStates[item].reviewState}</b>
      </button>)}
    </nav>
    {phase === "Requirements" ? <RequirementsGate workspace={workspace} /> : null}
    {phase === "Specification" ? <SpecificationPanel workspace={workspace} busy={busy} blocked={!requirementsApproved} setDialog={setDialog} run={run} /> : null}
    {phase === "Solution Design" ? <DesignPanel workspace={workspace} busy={busy} blocked={workspace.phaseStates.Specification.reviewState !== "Approved"} setDialog={setDialog} run={run} /> : null}
    {phase === "Verification Planning" ? <VerificationPanel workspace={workspace} busy={busy} blocked={workspace.phaseStates["Solution Design"].reviewState !== "Approved"} setDialog={setDialog} run={run} /> : null}
    {phase === "Delivery Readiness" ? <ReadinessPanel workspace={workspace} busy={busy} blocked={workspace.phaseStates["Verification Planning"].reviewState !== "Approved"} setDialog={setDialog} run={run} /> : null}
    {dialog}
  </section>;
}

type PanelProps = { workspace: Workspace; busy: boolean; blocked: boolean; setDialog: (dialog: ReactNode) => void; run: (operation: () => Promise<unknown>) => Promise<void> };

function RequirementsGate({ workspace }: { workspace: Workspace }) {
  const state = workspace.phaseStates.Requirements.reviewState;
  return <div className="phase-panel"><PhaseHeader phase="Requirements" state={state} validity="See Requirement Baselines above" />
    <p>{state === "Approved" ? `${workspace.requirements.length} approved Requirement revisions are available as the trace source for Specification.` : "Requirements approval is required before Specification can enter review."}</p>
  </div>;
}

function SpecificationPanel({ workspace, busy, blocked, setDialog, run }: PanelProps) {
  const phase: ArtifactPhase = "Specification";
  const artifact = workspace.specification;
  return <div className="phase-panel"><PhaseHeader phase={phase} state={workspace.phaseStates[phase].reviewState} validity={phaseValidity(workspace, phase)} />
    <Gate blocked={blocked}>Requirements must be Approved before Specification review can proceed.</Gate>
    <PhaseActions phase={phase} workspace={workspace} busy={busy} blocked={blocked} hasArtifact={Boolean(artifact)} setDialog={setDialog} run={run} edit={() => setDialog(<SpecificationForm workspace={workspace} close={() => setDialog(null)} submit={run} />)} />
    {artifact ? <PanelSection title={artifact.title} meta={`Revision ${artifact.revisionNumber} · ${artifact.state}`}><p className="artifact-copy">{artifact.behavior}</p><dl className="trace-summary"><div><dt>Acceptance criteria</dt><dd>{artifact.criteria.map((item) => `${item.key}: ${item.text}`).join(" · ")}</dd></div><div><dt>Requirement traces</dt><dd>{artifact.requirementRevisionIds.length} approved revisions</dd></div></dl></PanelSection> : <EmptyArtifact>Create a Specification and trace it to approved Requirements.</EmptyArtifact>}
    <ValidationView validation={workspace.latestValidations[phase]} />
    <ArtifactHistory workspace={workspace} phase={phase} />
  </div>;
}

function DesignPanel({ workspace, busy, blocked, setDialog, run }: PanelProps) {
  const phase: ArtifactPhase = "Solution Design";
  const artifact = workspace.design;
  return <div className="phase-panel"><PhaseHeader phase={phase} state={workspace.phaseStates[phase].reviewState} validity={phaseValidity(workspace, phase)} />
    <Gate blocked={blocked}>An approved Specification is required before Solution Design review can proceed.</Gate>
    <PhaseActions phase={phase} workspace={workspace} busy={busy} blocked={blocked} hasArtifact={Boolean(artifact)} setDialog={setDialog} run={run} edit={() => setDialog(<DesignForm workspace={workspace} close={() => setDialog(null)} submit={run} />)} />
    {artifact ? <PanelSection title={artifact.title} meta={`Revision ${artifact.revisionNumber} · ${artifact.state}`}><p className="artifact-copy">{artifact.summary}</p><dl className="trace-summary"><div><dt>Specification traces</dt><dd>{artifact.specificationRevisionIds.length}</dd></div><div><dt>Requirement traces</dt><dd>{artifact.requirementRevisionIds.length}</dd></div></dl></PanelSection> : <EmptyArtifact>Create a Solution Design with explicit upstream traces.</EmptyArtifact>}
    <ValidationView validation={workspace.latestValidations[phase]} />
    <ArtifactHistory workspace={workspace} phase={phase} />
  </div>;
}

function VerificationPanel({ workspace, busy, blocked, setDialog, run }: PanelProps) {
  const phase: ArtifactPhase = "Verification Planning";
  const artifact = workspace.verificationPlan;
  return <div className="phase-panel"><PhaseHeader phase={phase} state={workspace.phaseStates[phase].reviewState} validity={phaseValidity(workspace, phase)} />
    <Gate blocked={blocked}>An approved Solution Design is required before Verification Planning review can proceed.</Gate>
    <PhaseActions phase={phase} workspace={workspace} busy={busy} blocked={blocked} hasArtifact={Boolean(artifact)} setDialog={setDialog} run={run} edit={() => setDialog(<VerificationForm workspace={workspace} close={() => setDialog(null)} submit={run} />)} />
    {artifact ? <PanelSection title={artifact.title} meta={`Revision ${artifact.revisionNumber} · ${artifact.state}`}>
      <div className="compact-record-list">{artifact.cases.map((item) => <article key={item.id}><header><b>{item.key}</b><span>{item.responsibleTeam || "No responsible team"}</span></header><p>{item.method}</p><small>Success: {item.successCriteria} · Condition: {item.executionCondition}</small></article>)}</div>
    </PanelSection> : <EmptyArtifact>Create verification cases with method, success criteria, execution condition, responsible team, and traces.</EmptyArtifact>}
    <ValidationView validation={workspace.latestValidations[phase]} />
    <ArtifactHistory workspace={workspace} phase={phase} />
  </div>;
}

function ReadinessPanel({ workspace, busy, blocked, setDialog, run }: PanelProps) {
  const phase = "Delivery Readiness" as const;
  const state = workspace.phaseStates[phase];
  const latestBaseline = workspace.readinessBaselines[0];
  const canEdit = !blocked && state.reviewState !== "In Review";
  const action = (kind: "request-review" | "request-changes" | "approve") => setDialog(<PhaseDecisionForm phase={phase} action={kind} close={() => setDialog(null)} submit={(input) => run(() => workbenchApi.transitionDeliveryReadiness(workspace.feature.id, kind, { expectedFeatureVersion: workspace.feature.version, expectedPhaseVersion: state.version, ...input }))} />);
  return <div className="phase-panel"><PhaseHeader phase={phase} state={state.reviewState} validity={latestBaseline?.validity ?? "Not Evaluated"} />
    <Gate blocked={blocked}>An approved Verification Plan is required before Delivery Readiness review can proceed.</Gate>
    <div className="phase-actions">
      <button className="ghost" disabled={busy || blocked} onClick={() => run(() => workbenchApi.validateDeliveryReadiness(workspace.feature.id, workspace.feature.version))}>Validate readiness</button>
      {canEdit ? <><button className="ghost" disabled={busy} onClick={() => setDialog(<WorkPackageForm workspace={workspace} close={() => setDialog(null)} submit={run} />)}>Add Work Package</button><button className="ghost" disabled={busy} onClick={() => setDialog(<DeliverableForm workspace={workspace} close={() => setDialog(null)} submit={run} />)}>Add Deliverable</button></> : null}
      {(state.reviewState === "Draft" || state.reviewState === "Changes Requested") ? <button className="primary" disabled={busy || blocked} onClick={() => action("request-review")}>Request review</button> : null}
      {state.reviewState === "In Review" ? <><button className="ghost" disabled={busy} onClick={() => action("request-changes")}>Request changes</button><button className="primary" disabled={busy} onClick={() => action("approve")}>Approve Delivery Readiness</button></> : null}
    </div>
    <PanelSection title="Work Packages" meta={`${workspace.workPackages.length} records`}>
      <div className="compact-record-list">{workspace.workPackages.map((item) => <article key={item.id}><header><div><code>{item.key}</code><b>{item.type}</b></div><span>{item.owningTeam || "No owning team"}</span></header><p>{item.description}</p><small>{item.predecessorIds.length} predecessors · {item.designRevisionIds.length} design traces · {item.verificationRevisionIds.length} verification traces</small>{canEdit ? <button className="ghost" onClick={() => setDialog(<WorkPackageForm workspace={workspace} item={item} close={() => setDialog(null)} submit={run} />)}>Edit</button> : null}</article>)}</div>
      {!workspace.workPackages.length ? <EmptyArtifact>No Work Packages have been defined.</EmptyArtifact> : null}
    </PanelSection>
    <PanelSection title="Deliverables" meta={`${workspace.deliverables.length} records`}>
      <div className="compact-record-list">{workspace.deliverables.map((item) => <article key={item.id}><header><b>{item.name}</b><span>Revision {item.revisionNumber} · {item.state}</span></header><p>{item.description}</p><small>{item.targetSystem} · {item.targetEnvironment} · artifact {item.artifactRevisionLabel}</small>{canEdit ? <button className="ghost" onClick={() => setDialog(<DeliverableForm workspace={workspace} item={item} close={() => setDialog(null)} submit={run} />)}>{item.state === "Approved" ? "Create successor revision" : "Edit"}</button> : null}</article>)}</div>
      {!workspace.deliverables.length ? <EmptyArtifact>No Deliverables have been defined. Release Train assignment is unavailable in Phase 2.</EmptyArtifact> : null}
    </PanelSection>
    <ValidationView validation={workspace.latestReadinessValidation} />
    <PanelSection title="Approved Delivery Readiness Baselines" meta={`${workspace.readinessBaselines.length} approvals`}>
      {workspace.readinessBaselines.map((baseline) => <article className="baseline-record" key={baseline.id}><header><b>Baseline {baseline.baselineNumber}</b><span>{baseline.validity}</span></header><p>Requirements, Specification, Design, Verification, Work Packages, and Deliverable revisions were frozen together.</p><blockquote>{baseline.approval.rationale}</blockquote>{baseline.approval.warningRationale ? <small>Warning rationale: {baseline.approval.warningRationale}</small> : null}<small>Approved by {baseline.approval.actorName}</small></article>)}
      {!workspace.readinessBaselines.length ? <EmptyArtifact>No Delivery Readiness Baseline has been approved.</EmptyArtifact> : null}
    </PanelSection>
  </div>;
}

function PhaseActions({ phase, workspace, busy, blocked, hasArtifact, setDialog, run, edit }: PanelProps & { phase: ArtifactPhase; hasArtifact: boolean; edit: () => void }) {
  const state = workspace.phaseStates[phase];
  const canEdit = !blocked && state.reviewState !== "In Review";
  const action = (kind: "request-review" | "request-changes" | "approve") => setDialog(<PhaseDecisionForm phase={phase} action={kind} close={() => setDialog(null)} submit={(input) => run(() => workbenchApi.transitionPhase(workspace.feature.id, phase, kind, { expectedFeatureVersion: workspace.feature.version, expectedPhaseVersion: state.version, ...input }))} />);
  return <div className="phase-actions">
    <button className="ghost" disabled={busy || !hasArtifact} onClick={() => run(() => workbenchApi.validatePhase(workspace.feature.id, phase, workspace.feature.version))}>Validate trace graph</button>
    {canEdit ? <button className="ghost" disabled={busy} onClick={edit}>{hasArtifact ? "Edit or create successor" : `Create ${phase}`}</button> : null}
    {(state.reviewState === "Draft" || state.reviewState === "Changes Requested") ? <button className="primary" disabled={busy || blocked || !hasArtifact} onClick={() => action("request-review")}>Request review</button> : null}
    {state.reviewState === "In Review" ? <><button className="ghost" disabled={busy} onClick={() => action("request-changes")}>Request changes</button><button className="primary" disabled={busy} onClick={() => action("approve")}>Approve {phase}</button></> : null}
  </div>;
}

function PhaseHeader({ phase, state, validity }: { phase: string; state: ReviewState; validity: string }) {
  return <header className="phase-panel-header"><div><span className="eyebrow">Feature phase</span><h3>{phase}</h3></div><dl><div><dt>Review State</dt><dd>{state}</dd></div><div><dt>Baseline Validity</dt><dd>{validity}</dd></div></dl></header>;
}

function phaseValidity(workspace: Workspace, phase: ArtifactPhase) {
  return workspace.artifactBaselines.find((baseline) => baseline.phase === phase)?.validity ?? "Not Evaluated";
}

function Gate({ blocked, children }: { blocked: boolean; children: ReactNode }) {
  return blocked ? <p className="phase-gate"><b>Review gate:</b> {children}</p> : null;
}

function EmptyArtifact({ children }: { children: ReactNode }) {
  return <p className="workbench-empty">{children}</p>;
}

function ValidationView({ validation }: { validation: ArtifactValidation | ReadinessValidation | undefined | null }) {
  return <PanelSection title="Latest deterministic validation" meta={validation?.validatorVersion ?? "Not run"}>
    {validation?.findings.map((finding, index) => <Finding finding={finding} key={finding.id ?? `${finding.code}-${index}`} />)}
    {!validation ? <EmptyArtifact>Run validation to evaluate only the structural checks listed for this phase.</EmptyArtifact> : null}
  </PanelSection>;
}

function Finding({ finding }: { finding: TraceFinding }) {
  return <article className={`finding-record severity-${finding.severity.toLowerCase()}`}><span>{finding.severity}</span><div><b>{finding.message}</b><code>{finding.code}</code></div></article>;
}

function ArtifactHistory({ workspace, phase }: { workspace: Workspace; phase: ArtifactPhase }) {
  const baselines = workspace.artifactBaselines.filter((baseline) => baseline.phase === phase);
  return <PanelSection title={`Approved ${phase} Baselines`} meta={`${baselines.length} approvals`}>
    {baselines.map((baseline) => <article className="baseline-record" key={baseline.id}><header><b>Baseline {baseline.baselineNumber}</b><span>{baseline.validity}</span></header><p>Frozen revision {baseline.revisionId}</p><blockquote>{baseline.approval.rationale}</blockquote>{baseline.approval.warningRationale ? <small>Warning rationale: {baseline.approval.warningRationale}</small> : null}<small>Approved by {baseline.approval.actorName}</small></article>)}
    {!baselines.length ? <EmptyArtifact>No approved baseline exists for this phase.</EmptyArtifact> : null}
  </PanelSection>;
}
