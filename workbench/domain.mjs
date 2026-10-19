export const REVIEW_STATES = Object.freeze([
  "Not Started",
  "Draft",
  "In Review",
  "Changes Requested",
  "Approved",
  "Superseded",
]);

export const BASELINE_VALIDITIES = Object.freeze(["Not Evaluated", "Current", "Impacted", "Invalid"]);
export const CANDIDATE_STATUSES = Object.freeze(["Pending", "Accepted", "Rejected"]);
export const FINDING_SEVERITIES = Object.freeze(["Blocker", "Warning", "Info"]);

export class WorkbenchError extends Error {
  constructor(message, status = 400, code = "INVALID_COMMAND", details) {
    super(message);
    this.name = "WorkbenchError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function assertExpectedVersion(actual, expected, resourceName) {
  if (actual !== expected) {
    throw new WorkbenchError(
      `${resourceName} changed after it was loaded. Reload and retry with version ${actual}.`,
      409,
      "STALE_VERSION",
      { expectedVersion: expected, currentVersion: actual },
    );
  }
}

export function assertReviewTransition(current, next) {
  const allowed = {
    "Not Started": ["Draft"],
    Draft: ["In Review"],
    "In Review": ["Changes Requested", "Approved"],
    "Changes Requested": ["Draft", "In Review"],
    Approved: ["Draft", "Superseded"],
    Superseded: [],
  };
  if (!REVIEW_STATES.includes(current) || !allowed[current].includes(next)) {
    throw new WorkbenchError(
      `Requirements review cannot move from ${current} to ${next}.`,
      409,
      "INVALID_TRANSITION",
      { current, requested: next },
    );
  }
}

function finding(severity, code, message, requirementRevisionId = null) {
  return { severity, code, message, requirementRevisionId };
}

export function validateFeatureConsistency(snapshot) {
  const findings = [];
  const byKey = new Map();
  const knownKeys = new Set(snapshot.requirements.map((requirement) => requirement.externalKey.trim()).filter(Boolean));

  for (const requirement of snapshot.requirements) {
    const title = requirement.title.trim();
    const text = requirement.text.trim();
    const key = requirement.externalKey.trim();
    if (!title) findings.push(finding("Blocker", "MISSING_TITLE", "A requirement title is required.", requirement.id));
    if (!text) findings.push(finding("Blocker", "MISSING_TEXT", "Requirement text is required.", requirement.id));
    if (!key) {
      findings.push(finding("Blocker", "MISSING_EXTERNAL_KEY", "A requirement key is required.", requirement.id));
    } else {
      const existing = byKey.get(key);
      if (existing) {
        findings.push(finding("Blocker", "DUPLICATE_EXTERNAL_KEY", `Requirement key ${key} is used by more than one requirement.`, requirement.id));
      } else {
        byKey.set(key, requirement.id);
      }
    }

    for (const referenceKey of requirement.referenceKeys) {
      if (!knownKeys.has(referenceKey)) {
        findings.push(finding("Blocker", "BROKEN_REFERENCE", `Reference ${referenceKey} does not identify a current requirement.`, requirement.id));
      }
    }
    for (const conflict of requirement.conflicts) {
      if (!knownKeys.has(conflict.targetExternalKey)) {
        findings.push(finding("Blocker", "BROKEN_CONFLICT_REFERENCE", `Conflict target ${conflict.targetExternalKey} does not identify a current requirement.`, requirement.id));
      } else if (!conflict.resolved) {
        findings.push(finding("Blocker", "UNRESOLVED_CONFLICT", `Conflict with ${conflict.targetExternalKey} must be resolved before approval.`, requirement.id));
      }
    }
    if (requirement.referenceKeys.length === 0) {
      findings.push(finding("Warning", "NO_TRACE_REFERENCE", `Requirement ${key || title || "(untitled)"} has no trace reference.`, requirement.id));
    }
  }

  const pendingCount = snapshot.candidates.filter((candidate) => candidate.status === "Pending").length;
  if (pendingCount > 0) {
    findings.push(finding("Blocker", "UNDISPOSITIONED_CANDIDATES", `${pendingCount} requirement candidate${pendingCount === 1 ? " is" : "s are"} still pending disposition.`));
  }
  if (snapshot.requirements.length === 0) {
    findings.push(finding("Blocker", "NO_REQUIREMENTS", "At least one requirement must be accepted before review."));
  }
  if (findings.length === 0) findings.push(finding("Info", "CONSISTENT", "All implemented deterministic consistency checks passed."));
  return findings;
}

export function assertCanRequestReview(reviewState, findings) {
  if (!["Draft", "Changes Requested"].includes(reviewState)) {
    throw new WorkbenchError(`Review can only be requested from Draft or Changes Requested, not ${reviewState}.`, 409, "INVALID_TRANSITION");
  }
  if (findings.some((item) => item.severity === "Blocker")) {
    throw new WorkbenchError("Requirements review cannot be requested while blocker findings remain.", 409, "VALIDATION_BLOCKED");
  }
}

export function assertCanApprove(reviewState, findings, warningRationale) {
  if (reviewState !== "In Review") {
    throw new WorkbenchError(`Requirements can only be approved from In Review, not ${reviewState}.`, 409, "INVALID_TRANSITION");
  }
  if (findings.some((item) => item.severity === "Blocker")) {
    throw new WorkbenchError("Requirements cannot be approved while blocker findings remain.", 409, "VALIDATION_BLOCKED");
  }
  if (findings.some((item) => item.severity === "Warning") && !warningRationale.trim()) {
    throw new WorkbenchError("A warning rationale is required before approving with warnings.", 409, "WARNING_RATIONALE_REQUIRED");
  }
}
