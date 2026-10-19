import { useCallback, useEffect, useState, type ReactNode, type SubmitEvent as ReactSubmitEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { workbenchApi } from "./api";
import type { FeatureWorkspace as Workspace, RequirementCandidate, RequirementRevision } from "./types";
import { Phase2Workspace } from "./Phase2Workspace";
import { FormError, WorkbenchDialog } from "./WorkbenchDialog";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "The request could not be completed.";
}

function values(value: FormDataEntryValue | null) {
  return String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

export function FeatureWorkspace() {
  const { featureId = "" } = useParams();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<ReactNode>(null);
  const load = useCallback(() => {
    setError("");
    workbenchApi.getFeature(featureId).then(setWorkspace).catch((reason: unknown) => setError(errorMessage(reason)));
  }, [featureId]);
  useEffect(load, [load]);

  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await operation();
      setDialog(null);
      load();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  if (!workspace) return <section className="workbench-view"><FormError message={error} />{!error ? <p>Loading Feature workspace…</p> : null}</section>;
  const { feature } = workspace;
  const blockers = workspace.latestValidation?.findings.filter((item) => item.severity === "Blocker").length ?? 0;
  const warnings = workspace.latestValidation?.findings.filter((item) => item.severity === "Warning").length ?? 0;
  const currentBaseline = workspace.baselines[0];
  const canEdit = !["In Review", "Superseded"].includes(feature.reviewState);

  return <section className="workbench-view">
    <nav className="workbench-context" aria-label="Product and Feature breadcrumb">
      <Link to="/products">Products</Link><span aria-hidden="true">/</span><Link to={`/products/${workspace.product.id}`}>{workspace.product.name}</Link><span aria-hidden="true">/</span><span aria-current="page">{feature.name}</span>
    </nav>
    <header className="workbench-heading">
      <div><span className="eyebrow">Requirements phase</span><h1>{feature.name}</h1><p>{feature.summary || "No Feature summary"}</p></div>
      <div className="workbench-actions">
        <Link className="ghost header-link" to={`/products/${workspace.product.id}/planning`}>Open Planning</Link>
        <button className="ghost" disabled={busy} onClick={() => run(() => workbenchApi.validate(feature.id, feature.version))}>Run consistency validation</button>
        {(feature.reviewState === "Draft" || feature.reviewState === "Changes Requested") ? <button className="primary" disabled={busy} onClick={() => setDialog(<ReviewAction title="Request Requirements review" submitLabel="Request review" close={() => setDialog(null)} submit={(input) => run(() => workbenchApi.requestReview(feature.id, { expectedVersion: feature.version, ...input }))} />)}>Request review</button> : null}
        {feature.reviewState === "In Review" ? <>
          <button className="ghost" disabled={busy} onClick={() => setDialog(<ReviewAction title="Request Requirements changes" submitLabel="Request changes" close={() => setDialog(null)} submit={(input) => run(() => workbenchApi.requestChanges(feature.id, { expectedVersion: feature.version, ...input }))} />)}>Request changes</button>
          <button className="primary" disabled={busy} onClick={() => setDialog(<ApprovalAction warnings={warnings} close={() => setDialog(null)} submit={(input) => run(() => workbenchApi.approve(feature.id, { expectedVersion: feature.version, ...input }))} />)}>Approve Requirements</button>
        </> : null}
      </div>
    </header>
    <FormError message={error} />

    <div className="workbench-status-grid">
      <section aria-labelledby="review-state-heading"><span id="review-state-heading">Review State</span><b>{feature.reviewState}</b><p>Human workflow state for the Requirements phase.</p></section>
      <section aria-labelledby="baseline-validity-heading"><span id="baseline-validity-heading">Baseline Validity</span><b>{currentBaseline?.validity ?? "Not Evaluated"}</b><p>{currentBaseline ? `Baseline ${currentBaseline.baselineNumber} remains an immutable approval record.` : "No approved Requirement Baseline exists."}</p></section>
      <section aria-labelledby="validation-heading"><span id="validation-heading">Latest Validation</span><b>{blockers} blockers · {warnings} warnings</b><p>Deterministic structural checks only. No AI contradiction detection is connected.</p></section>
    </div>

    <WorkbenchSection title="Natural-language input" meta={`${workspace.sources.length} sources`} action={canEdit ? <button className="ghost" onClick={() => setDialog(<SourceForm workspace={workspace} close={() => setDialog(null)} submit={run} />)}>Add input</button> : null}>
      <p className="workbench-truth-note">Input is stored verbatim. Candidates are manually entered; no model generation is connected.</p>
      {workspace.sources.map((source) => <article className="source-record" key={source.id}><header><b>{source.provenance}</b><time dateTime={source.createdAt}>{new Date(source.createdAt).toLocaleString()}</time></header><p>{source.content}</p></article>)}
      {!workspace.sources.length ? <Empty>No requirement source content has been recorded.</Empty> : null}
    </WorkbenchSection>

    <WorkbenchSection title="Requirement candidates" meta={`${workspace.candidates.length} candidates`} action={canEdit && workspace.sources.length ? <button className="ghost" onClick={() => setDialog(<CandidateForm workspace={workspace} close={() => setDialog(null)} submit={run} />)}>Create candidate</button> : null}>
      {workspace.candidates.map((candidate) => <article className="candidate-record" key={candidate.id} tabIndex={0}>
        <div><span className={`candidate-status status-${candidate.status.toLowerCase()}`}>{candidate.status}</span><code>{candidate.externalKey || "No key"}</code><b>{candidate.title || "Untitled candidate"}</b><p>{candidate.text || "No requirement text"}</p>{candidate.decisionRationale ? <small>Decision: {candidate.decisionRationale}</small> : null}</div>
        {candidate.status === "Pending" && canEdit ? <div className="record-actions">
          <button className="ghost" onClick={() => setDialog(<CandidateForm workspace={workspace} candidate={candidate} close={() => setDialog(null)} submit={run} />)}>Edit</button>
          <button className="ghost" onClick={() => setDialog(<DispositionForm kind="reject" workspace={workspace} candidate={candidate} close={() => setDialog(null)} submit={run} />)}>Reject</button>
          <button className="primary" onClick={() => setDialog(<DispositionForm kind="accept" workspace={workspace} candidate={candidate} close={() => setDialog(null)} submit={run} />)}>Accept</button>
        </div> : null}
      </article>)}
      {!workspace.candidates.length ? <Empty>Create candidates manually from recorded input.</Empty> : null}
    </WorkbenchSection>

    <WorkbenchSection title="Requirement artifacts" meta={`${workspace.requirements.length} current revisions`}>
      {workspace.requirements.map((requirement) => <article className="requirement-record" key={requirement.id} tabIndex={0}>
        <header><div><code>{requirement.externalKey || "No key"}</code><b>{requirement.title || "Untitled requirement"}</b></div><span>Revision {requirement.revisionNumber} · {requirement.state}</span></header>
        <p>{requirement.text || "No requirement text"}</p>
        <dl><div><dt>References</dt><dd>{requirement.referenceKeys.join(", ") || "None"}</dd></div><div><dt>Explicit conflicts</dt><dd>{requirement.conflicts.map((item) => `${item.targetExternalKey} (${item.resolved ? "resolved" : "unresolved"})`).join(", ") || "None"}</dd></div></dl>
        {canEdit ? <button className="ghost" onClick={() => setDialog(<RequirementForm workspace={workspace} requirement={requirement} close={() => setDialog(null)} submit={run} />)}>{requirement.state === "Approved" ? "Create successor revision" : "Edit draft"}</button> : null}
      </article>)}
      {!workspace.requirements.length ? <Empty>Accept a candidate to create the first Requirement revision.</Empty> : null}
    </WorkbenchSection>

    <WorkbenchSection title="Consistency findings" meta={workspace.latestValidation ? workspace.latestValidation.validatorVersion : "Not run"}>
      {workspace.latestValidation?.findings.map((finding, index) => <article className={`finding-record severity-${finding.severity.toLowerCase()}`} key={finding.id ?? `${finding.code}-${index}`}><span>{finding.severity}</span><div><b>{finding.message}</b><code>{finding.code}</code></div></article>)}
      {!workspace.latestValidation ? <Empty>Run validation to check missing fields, duplicate keys, unresolved explicit conflicts, and reference integrity.</Empty> : null}
    </WorkbenchSection>

    <WorkbenchSection title="Approved Requirement Baselines" meta={`${workspace.baselines.length} approvals`}>
      {workspace.baselines.map((baseline) => <article className="baseline-record" key={baseline.id}>
        <header><b>Baseline {baseline.baselineNumber}</b><span>{baseline.validity}</span></header>
        <p>{baseline.revisionCount} frozen revisions · approved by {baseline.approval.actorName}</p>
        <blockquote>{baseline.approval.rationale}</blockquote>
        {baseline.approval.warningRationale ? <small>Warning rationale: {baseline.approval.warningRationale}</small> : null}
        <time dateTime={baseline.approval.createdAt}>{new Date(baseline.approval.createdAt).toLocaleString()}</time>
      </article>)}
      {!workspace.baselines.length ? <Empty>No Requirement Baseline has been approved.</Empty> : null}
    </WorkbenchSection>
    <Phase2Workspace featureId={feature.id} onChanged={load} />
    {dialog}
  </section>;
}

function WorkbenchSection({ title, meta, action, children }: { title: string; meta: string; action?: ReactNode; children: ReactNode }) {
  return <section className="workbench-section"><header><div><h2>{title}</h2><span>{meta}</span></div>{action}</header>{children}</section>;
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="workbench-empty">{children}</p>;
}

function SourceForm({ workspace, close, submit }: { workspace: Workspace; close: () => void; submit: (operation: () => Promise<unknown>) => Promise<void> }) {
  const save = (event: ReactSubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    return submit(() => workbenchApi.addSource(workspace.feature.id, {
      expectedVersion: workspace.feature.version,
      content: String(form.get("content") ?? ""),
      provenance: String(form.get("provenance")) === "Deterministic Sample" ? "Deterministic Sample" : "Manual",
    }));
  };
  return <WorkbenchDialog title="Add natural-language input" close={close}><form onSubmit={save}>
    <label>Provenance<select name="provenance"><option>Manual</option><option>Deterministic Sample</option></select></label>
    <label>Source content<textarea autoFocus required name="content" rows={8} /></label>
    <p className="form-note">This stores source content only. It does not invoke an AI model.</p>
    <button className="primary save-button">Save input</button>
  </form></WorkbenchDialog>;
}

function CandidateForm({ workspace, candidate, close, submit }: { workspace: Workspace; candidate?: RequirementCandidate; close: () => void; submit: (operation: () => Promise<unknown>) => Promise<void> }) {
  const save = (event: ReactSubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const fields = { externalKey: String(form.get("externalKey") ?? ""), title: String(form.get("title") ?? ""), text: String(form.get("text") ?? "") };
    return candidate
      ? submit(() => workbenchApi.editCandidate(workspace.feature.id, candidate.id, { ...fields, expectedVersion: candidate.version, expectedFeatureVersion: workspace.feature.version, referenceKeys: [], conflicts: [] }))
      : submit(() => workbenchApi.createCandidate(workspace.feature.id, { ...fields, expectedVersion: workspace.feature.version, sourceId: String(form.get("sourceId") ?? "") }));
  };
  return <WorkbenchDialog title={candidate ? "Edit requirement candidate" : "Create requirement candidate"} close={close}><form onSubmit={save}>
    {!candidate ? <label>Source<select name="sourceId" defaultValue={workspace.sources[0]?.id}>{workspace.sources.map((source) => <option value={source.id} key={source.id}>{source.provenance} · {source.content.slice(0, 72)}</option>)}</select></label> : null}
    <label>Requirement key<input autoFocus name="externalKey" defaultValue={candidate?.externalKey} placeholder="REQ-001" /></label>
    <label>Title<input name="title" defaultValue={candidate?.title} /></label>
    <label>Requirement text<textarea name="text" rows={5} defaultValue={candidate?.text} /></label>
    <p className="form-note">Candidates are manually authored from the selected source.</p>
    <button className="primary save-button">{candidate ? "Save candidate" : "Create candidate"}</button>
  </form></WorkbenchDialog>;
}

function DispositionForm({ kind, workspace, candidate, close, submit }: { kind: "accept" | "reject"; workspace: Workspace; candidate: RequirementCandidate; close: () => void; submit: (operation: () => Promise<unknown>) => Promise<void> }) {
  const save = (event: ReactSubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const common = { expectedVersion: candidate.version, expectedFeatureVersion: workspace.feature.version, rationale: String(form.get("rationale") ?? "") };
    if (kind === "reject") return submit(() => workbenchApi.rejectCandidate(workspace.feature.id, candidate.id, common));
    const resolved = form.get("resolved") === "on";
    return submit(() => workbenchApi.acceptCandidate(workspace.feature.id, candidate.id, {
      ...common,
      referenceKeys: values(form.get("references")),
      conflicts: values(form.get("conflicts")).map((targetExternalKey) => ({ targetExternalKey, resolved })),
    }));
  };
  return <WorkbenchDialog title={`${kind === "accept" ? "Accept" : "Reject"} requirement candidate`} close={close}><form onSubmit={save}>
    <p><b>{candidate.externalKey || "No key"} · {candidate.title || "Untitled candidate"}</b></p>
    <label>Decision rationale<textarea autoFocus required name="rationale" rows={3} /></label>
    {kind === "accept" ? <>
      <label>Trace references <span>(comma-separated keys)</span><input name="references" /></label>
      <label>Explicit conflicts <span>(comma-separated keys)</span><input name="conflicts" /></label>
      <label className="workbench-checkbox"><input type="checkbox" name="resolved" /><span>All listed explicit conflicts are resolved.</span></label>
    </> : null}
    <button className="primary save-button">Record {kind} decision</button>
  </form></WorkbenchDialog>;
}

function RequirementForm({ workspace, requirement, close, submit }: { workspace: Workspace; requirement: RequirementRevision; close: () => void; submit: (operation: () => Promise<unknown>) => Promise<void> }) {
  const save = (event: ReactSubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const resolved = form.get("resolved") === "on";
    return submit(() => workbenchApi.editRequirement(workspace.feature.id, requirement.id, {
      expectedVersion: requirement.version,
      expectedFeatureVersion: workspace.feature.version,
      externalKey: String(form.get("externalKey") ?? ""),
      title: String(form.get("title") ?? ""),
      text: String(form.get("text") ?? ""),
      referenceKeys: values(form.get("references")),
      conflicts: values(form.get("conflicts")).map((targetExternalKey) => ({ targetExternalKey, resolved })),
    }));
  };
  return <WorkbenchDialog title={requirement.state === "Approved" ? "Create successor Requirement revision" : "Edit Requirement draft"} close={close}><form onSubmit={save}>
    {requirement.state === "Approved" ? <p className="form-note">The approved revision remains unchanged. Saving creates a successor Draft revision.</p> : null}
    <label>Requirement key<input autoFocus name="externalKey" defaultValue={requirement.externalKey} /></label>
    <label>Title<input name="title" defaultValue={requirement.title} /></label>
    <label>Requirement text<textarea name="text" rows={6} defaultValue={requirement.text} /></label>
    <label>Trace references <span>(comma-separated keys)</span><input name="references" defaultValue={requirement.referenceKeys.join(", ")} /></label>
    <label>Explicit conflicts <span>(comma-separated keys)</span><input name="conflicts" defaultValue={requirement.conflicts.map((item) => item.targetExternalKey).join(", ")} /></label>
    <label className="workbench-checkbox"><input type="checkbox" name="resolved" defaultChecked={requirement.conflicts.length > 0 && requirement.conflicts.every((item) => item.resolved)} /><span>All listed explicit conflicts are resolved.</span></label>
    <button className="primary save-button">{requirement.state === "Approved" ? "Create successor Draft" : "Save Draft"}</button>
  </form></WorkbenchDialog>;
}

function ReviewAction({ title, submitLabel, close, submit }: { title: string; submitLabel: string; close: () => void; submit: (input: { actorName: string; rationale: string }) => Promise<void> }) {
  const save = (event: ReactSubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    return submit({ actorName: String(form.get("actorName") ?? ""), rationale: String(form.get("rationale") ?? "") });
  };
  return <WorkbenchDialog title={title} close={close}><form onSubmit={save}>
    <label>Actor name<input autoFocus required name="actorName" /></label>
    <label>Rationale<textarea required name="rationale" rows={4} /></label>
    <button className="primary save-button">{submitLabel}</button>
  </form></WorkbenchDialog>;
}

function ApprovalAction({ warnings, close, submit }: { warnings: number; close: () => void; submit: (input: { actorName: string; rationale: string; warningRationale: string }) => Promise<void> }) {
  const save = (event: ReactSubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    return submit({ actorName: String(form.get("actorName") ?? ""), rationale: String(form.get("rationale") ?? ""), warningRationale: String(form.get("warningRationale") ?? "") });
  };
  return <WorkbenchDialog title="Approve Requirements phase" close={close}><form onSubmit={save}>
    <p className="form-note">Approval freezes the exact current Requirement revision set as a persisted Baseline.</p>
    <label>Approver name<input autoFocus required name="actorName" /></label>
    <label>Approval rationale<textarea required name="rationale" rows={4} /></label>
    {warnings > 0 ? <label>Warning rationale <span>({warnings} warnings)</span><textarea required name="warningRationale" rows={4} /></label> : null}
    <button className="primary save-button">Approve and freeze Baseline</button>
  </form></WorkbenchDialog>;
}
