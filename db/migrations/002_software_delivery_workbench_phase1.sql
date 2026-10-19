BEGIN;

CREATE TABLE workbench_products (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (btrim(name) <> ''),
  description text NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workbench_features (
  id uuid PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES workbench_products(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (btrim(name) <> ''),
  summary text NOT NULL DEFAULT '',
  requirements_review_state text NOT NULL DEFAULT 'Not Started'
    CHECK (requirements_review_state IN ('Not Started', 'Draft', 'In Review', 'Changes Requested', 'Approved', 'Superseded')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, name)
);

CREATE TABLE workbench_requirement_sources (
  id uuid PRIMARY KEY,
  feature_id uuid NOT NULL REFERENCES workbench_features(id) ON DELETE RESTRICT,
  content text NOT NULL,
  provenance text NOT NULL CHECK (provenance IN ('Manual', 'Deterministic Sample')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workbench_requirement_candidates (
  id uuid PRIMARY KEY,
  feature_id uuid NOT NULL REFERENCES workbench_features(id) ON DELETE RESTRICT,
  source_id uuid NOT NULL REFERENCES workbench_requirement_sources(id) ON DELETE RESTRICT,
  external_key text NOT NULL,
  title text NOT NULL,
  requirement_text text NOT NULL,
  status text NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Accepted', 'Rejected')),
  decision_rationale text,
  accepted_requirement_id uuid,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workbench_requirements (
  id uuid PRIMARY KEY,
  feature_id uuid NOT NULL REFERENCES workbench_features(id) ON DELETE RESTRICT,
  external_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE workbench_requirement_candidates
  ADD CONSTRAINT workbench_candidate_accepted_requirement_fk
  FOREIGN KEY (accepted_requirement_id) REFERENCES workbench_requirements(id) ON DELETE RESTRICT;

CREATE TABLE workbench_requirement_revisions (
  id uuid PRIMARY KEY,
  requirement_id uuid NOT NULL REFERENCES workbench_requirements(id) ON DELETE RESTRICT,
  external_key text NOT NULL,
  revision_number integer NOT NULL CHECK (revision_number > 0),
  title text NOT NULL,
  requirement_text text NOT NULL,
  revision_state text NOT NULL DEFAULT 'Draft' CHECK (revision_state IN ('Draft', 'Approved', 'Superseded')),
  predecessor_revision_id uuid REFERENCES workbench_requirement_revisions(id) ON DELETE RESTRICT,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (requirement_id, revision_number)
);

CREATE UNIQUE INDEX workbench_one_draft_per_requirement
  ON workbench_requirement_revisions(requirement_id)
  WHERE revision_state = 'Draft';

CREATE TABLE workbench_requirement_revision_references (
  revision_id uuid NOT NULL REFERENCES workbench_requirement_revisions(id) ON DELETE RESTRICT,
  target_external_key text NOT NULL,
  PRIMARY KEY (revision_id, target_external_key)
);

CREATE TABLE workbench_requirement_revision_conflicts (
  revision_id uuid NOT NULL REFERENCES workbench_requirement_revisions(id) ON DELETE RESTRICT,
  target_external_key text NOT NULL,
  resolved boolean NOT NULL DEFAULT false,
  PRIMARY KEY (revision_id, target_external_key)
);

CREATE TABLE workbench_validation_runs (
  id uuid PRIMARY KEY,
  feature_id uuid NOT NULL REFERENCES workbench_features(id) ON DELETE RESTRICT,
  feature_version integer NOT NULL,
  validator_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workbench_validation_findings (
  id uuid PRIMARY KEY,
  validation_run_id uuid NOT NULL REFERENCES workbench_validation_runs(id) ON DELETE RESTRICT,
  severity text NOT NULL CHECK (severity IN ('Blocker', 'Warning', 'Info')),
  code text NOT NULL,
  message text NOT NULL,
  requirement_revision_id uuid REFERENCES workbench_requirement_revisions(id) ON DELETE RESTRICT
);

CREATE TABLE workbench_requirement_baselines (
  id uuid PRIMARY KEY,
  feature_id uuid NOT NULL REFERENCES workbench_features(id) ON DELETE RESTRICT,
  baseline_number integer NOT NULL CHECK (baseline_number > 0),
  validity text NOT NULL DEFAULT 'Current' CHECK (validity IN ('Not Evaluated', 'Current', 'Impacted', 'Invalid')),
  validation_run_id uuid NOT NULL REFERENCES workbench_validation_runs(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (feature_id, baseline_number)
);

CREATE TABLE workbench_requirement_baseline_items (
  baseline_id uuid NOT NULL REFERENCES workbench_requirement_baselines(id) ON DELETE RESTRICT,
  revision_id uuid NOT NULL REFERENCES workbench_requirement_revisions(id) ON DELETE RESTRICT,
  PRIMARY KEY (baseline_id, revision_id)
);

CREATE TABLE workbench_requirement_baseline_validity_events (
  id uuid PRIMARY KEY,
  baseline_id uuid NOT NULL REFERENCES workbench_requirement_baselines(id) ON DELETE RESTRICT,
  validity text NOT NULL CHECK (validity IN ('Not Evaluated', 'Current', 'Impacted', 'Invalid')),
  rationale text NOT NULL CHECK (btrim(rationale) <> ''),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workbench_requirement_approvals (
  id uuid PRIMARY KEY,
  baseline_id uuid NOT NULL REFERENCES workbench_requirement_baselines(id) ON DELETE RESTRICT,
  actor_name text NOT NULL CHECK (btrim(actor_name) <> ''),
  rationale text NOT NULL CHECK (btrim(rationale) <> ''),
  warning_rationale text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workbench_review_events (
  id uuid PRIMARY KEY,
  feature_id uuid NOT NULL REFERENCES workbench_features(id) ON DELETE RESTRICT,
  from_state text NOT NULL,
  to_state text NOT NULL,
  actor_name text NOT NULL CHECK (btrim(actor_name) <> ''),
  rationale text NOT NULL CHECK (btrim(rationale) <> ''),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workbench_command_receipts (
  command_id text PRIMARY KEY,
  operation text NOT NULL,
  request_hash text NOT NULL,
  response_status integer NOT NULL,
  response_body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX workbench_features_product_idx ON workbench_features(product_id);
CREATE INDEX workbench_sources_feature_idx ON workbench_requirement_sources(feature_id);
CREATE INDEX workbench_candidates_feature_idx ON workbench_requirement_candidates(feature_id);
CREATE INDEX workbench_requirements_feature_idx ON workbench_requirements(feature_id);
CREATE INDEX workbench_validation_runs_feature_idx ON workbench_validation_runs(feature_id, created_at DESC);
CREATE INDEX workbench_baselines_feature_idx ON workbench_requirement_baselines(feature_id, baseline_number DESC);
CREATE INDEX workbench_baseline_validity_events_idx ON workbench_requirement_baseline_validity_events(baseline_id, created_at DESC);

CREATE FUNCTION workbench_protect_frozen_revision() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.revision_state IN ('Approved', 'Superseded') THEN
    IF TG_OP = 'UPDATE'
       AND OLD.revision_state = 'Approved'
       AND NEW.revision_state = 'Superseded'
       AND NEW.id = OLD.id
       AND NEW.requirement_id = OLD.requirement_id
       AND NEW.external_key = OLD.external_key
       AND NEW.revision_number = OLD.revision_number
       AND NEW.title = OLD.title
       AND NEW.requirement_text = OLD.requirement_text
       AND NEW.predecessor_revision_id IS NOT DISTINCT FROM OLD.predecessor_revision_id
       AND NEW.version = OLD.version
       AND NEW.created_at = OLD.created_at THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Approved and superseded Requirement revisions are immutable.' USING ERRCODE = '55000';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER workbench_frozen_revision_guard
BEFORE UPDATE OR DELETE ON workbench_requirement_revisions
FOR EACH ROW EXECUTE FUNCTION workbench_protect_frozen_revision();

CREATE FUNCTION workbench_reject_frozen_record_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Approved Requirement Baseline records are immutable.' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER workbench_baseline_guard
BEFORE UPDATE OR DELETE ON workbench_requirement_baselines
FOR EACH ROW EXECUTE FUNCTION workbench_reject_frozen_record_mutation();
CREATE TRIGGER workbench_baseline_item_guard
BEFORE UPDATE OR DELETE ON workbench_requirement_baseline_items
FOR EACH ROW EXECUTE FUNCTION workbench_reject_frozen_record_mutation();
CREATE TRIGGER workbench_baseline_validity_event_guard
BEFORE UPDATE OR DELETE ON workbench_requirement_baseline_validity_events
FOR EACH ROW EXECUTE FUNCTION workbench_reject_frozen_record_mutation();
CREATE TRIGGER workbench_approval_guard
BEFORE UPDATE OR DELETE ON workbench_requirement_approvals
FOR EACH ROW EXECUTE FUNCTION workbench_reject_frozen_record_mutation();

COMMIT;
