BEGIN;

CREATE TABLE workbench_feature_phase_states (
  feature_id uuid NOT NULL REFERENCES workbench_features(id) ON DELETE RESTRICT,
  phase text NOT NULL CHECK (phase IN ('Specification', 'Solution Design', 'Verification Planning', 'Delivery Readiness')),
  review_state text NOT NULL DEFAULT 'Not Started'
    CHECK (review_state IN ('Not Started', 'Draft', 'In Review', 'Changes Requested', 'Approved', 'Superseded')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (feature_id, phase)
);

CREATE TABLE workbench_specification_revisions (
  id uuid PRIMARY KEY,
  feature_id uuid NOT NULL REFERENCES workbench_features(id) ON DELETE RESTRICT,
  revision_number integer NOT NULL CHECK (revision_number > 0),
  title text NOT NULL,
  behavior text NOT NULL,
  revision_state text NOT NULL DEFAULT 'Draft' CHECK (revision_state IN ('Draft', 'Approved', 'Superseded')),
  predecessor_revision_id uuid REFERENCES workbench_specification_revisions(id) ON DELETE RESTRICT,
  author_name text NOT NULL CHECK (btrim(author_name) <> ''),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (feature_id, revision_number)
);

CREATE UNIQUE INDEX workbench_one_specification_draft
  ON workbench_specification_revisions(feature_id) WHERE revision_state = 'Draft';

CREATE TABLE workbench_specification_acceptance_criteria (
  id uuid PRIMARY KEY,
  revision_id uuid NOT NULL REFERENCES workbench_specification_revisions(id) ON DELETE RESTRICT,
  criterion_key text NOT NULL CHECK (btrim(criterion_key) <> ''),
  criterion_text text NOT NULL CHECK (btrim(criterion_text) <> ''),
  UNIQUE (revision_id, criterion_key)
);

CREATE TABLE workbench_acceptance_criterion_requirement_links (
  criterion_id uuid NOT NULL REFERENCES workbench_specification_acceptance_criteria(id) ON DELETE RESTRICT,
  requirement_revision_id uuid NOT NULL REFERENCES workbench_requirement_revisions(id) ON DELETE RESTRICT,
  PRIMARY KEY (criterion_id, requirement_revision_id)
);

CREATE TABLE workbench_specification_requirement_links (
  revision_id uuid NOT NULL REFERENCES workbench_specification_revisions(id) ON DELETE RESTRICT,
  requirement_revision_id uuid NOT NULL REFERENCES workbench_requirement_revisions(id) ON DELETE RESTRICT,
  PRIMARY KEY (revision_id, requirement_revision_id)
);

CREATE TABLE workbench_design_revisions (
  id uuid PRIMARY KEY,
  feature_id uuid NOT NULL REFERENCES workbench_features(id) ON DELETE RESTRICT,
  revision_number integer NOT NULL CHECK (revision_number > 0),
  title text NOT NULL,
  design_summary text NOT NULL,
  revision_state text NOT NULL DEFAULT 'Draft' CHECK (revision_state IN ('Draft', 'Approved', 'Superseded')),
  predecessor_revision_id uuid REFERENCES workbench_design_revisions(id) ON DELETE RESTRICT,
  author_name text NOT NULL CHECK (btrim(author_name) <> ''),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (feature_id, revision_number)
);

CREATE UNIQUE INDEX workbench_one_design_draft
  ON workbench_design_revisions(feature_id) WHERE revision_state = 'Draft';

CREATE TABLE workbench_design_specification_links (
  revision_id uuid NOT NULL REFERENCES workbench_design_revisions(id) ON DELETE RESTRICT,
  specification_revision_id uuid NOT NULL REFERENCES workbench_specification_revisions(id) ON DELETE RESTRICT,
  PRIMARY KEY (revision_id, specification_revision_id)
);

CREATE TABLE workbench_design_requirement_links (
  revision_id uuid NOT NULL REFERENCES workbench_design_revisions(id) ON DELETE RESTRICT,
  requirement_revision_id uuid NOT NULL REFERENCES workbench_requirement_revisions(id) ON DELETE RESTRICT,
  PRIMARY KEY (revision_id, requirement_revision_id)
);

CREATE TABLE workbench_design_acceptance_criterion_links (
  revision_id uuid NOT NULL REFERENCES workbench_design_revisions(id) ON DELETE RESTRICT,
  criterion_id uuid NOT NULL REFERENCES workbench_specification_acceptance_criteria(id) ON DELETE RESTRICT,
  PRIMARY KEY (revision_id, criterion_id)
);

CREATE TABLE workbench_verification_plan_revisions (
  id uuid PRIMARY KEY,
  feature_id uuid NOT NULL REFERENCES workbench_features(id) ON DELETE RESTRICT,
  revision_number integer NOT NULL CHECK (revision_number > 0),
  title text NOT NULL,
  revision_state text NOT NULL DEFAULT 'Draft' CHECK (revision_state IN ('Draft', 'Approved', 'Superseded')),
  predecessor_revision_id uuid REFERENCES workbench_verification_plan_revisions(id) ON DELETE RESTRICT,
  author_name text NOT NULL CHECK (btrim(author_name) <> ''),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (feature_id, revision_number)
);

CREATE UNIQUE INDEX workbench_one_verification_plan_draft
  ON workbench_verification_plan_revisions(feature_id) WHERE revision_state = 'Draft';

CREATE TABLE workbench_verification_cases (
  id uuid PRIMARY KEY,
  revision_id uuid NOT NULL REFERENCES workbench_verification_plan_revisions(id) ON DELETE RESTRICT,
  case_key text NOT NULL CHECK (btrim(case_key) <> ''),
  method text NOT NULL CHECK (btrim(method) <> ''),
  success_criteria text NOT NULL CHECK (btrim(success_criteria) <> ''),
  execution_condition text NOT NULL CHECK (btrim(execution_condition) <> ''),
  responsible_team text NOT NULL CHECK (btrim(responsible_team) <> ''),
  UNIQUE (revision_id, case_key)
);

CREATE TABLE workbench_verification_specification_links (
  case_id uuid NOT NULL REFERENCES workbench_verification_cases(id) ON DELETE RESTRICT,
  specification_revision_id uuid NOT NULL REFERENCES workbench_specification_revisions(id) ON DELETE RESTRICT,
  PRIMARY KEY (case_id, specification_revision_id)
);

CREATE TABLE workbench_verification_requirement_links (
  case_id uuid NOT NULL REFERENCES workbench_verification_cases(id) ON DELETE RESTRICT,
  requirement_revision_id uuid NOT NULL REFERENCES workbench_requirement_revisions(id) ON DELETE RESTRICT,
  PRIMARY KEY (case_id, requirement_revision_id)
);

CREATE TABLE workbench_verification_acceptance_criterion_links (
  case_id uuid NOT NULL REFERENCES workbench_verification_cases(id) ON DELETE RESTRICT,
  criterion_id uuid NOT NULL REFERENCES workbench_specification_acceptance_criteria(id) ON DELETE RESTRICT,
  PRIMARY KEY (case_id, criterion_id)
);

CREATE TABLE workbench_feature_artifact_validation_runs (
  id uuid PRIMARY KEY,
  feature_id uuid NOT NULL REFERENCES workbench_features(id) ON DELETE RESTRICT,
  phase text NOT NULL CHECK (phase IN ('Specification', 'Solution Design', 'Verification Planning')),
  feature_version integer NOT NULL,
  validator_version text NOT NULL,
  revision_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workbench_feature_artifact_validation_findings (
  id uuid PRIMARY KEY,
  validation_run_id uuid NOT NULL REFERENCES workbench_feature_artifact_validation_runs(id) ON DELETE RESTRICT,
  severity text NOT NULL CHECK (severity IN ('Blocker', 'Warning', 'Info')),
  code text NOT NULL,
  message text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workbench_feature_artifact_baselines (
  id uuid PRIMARY KEY,
  feature_id uuid NOT NULL REFERENCES workbench_features(id) ON DELETE RESTRICT,
  phase text NOT NULL CHECK (phase IN ('Specification', 'Solution Design', 'Verification Planning')),
  baseline_number integer NOT NULL CHECK (baseline_number > 0),
  revision_id uuid NOT NULL,
  validation_run_id uuid NOT NULL REFERENCES workbench_feature_artifact_validation_runs(id) ON DELETE RESTRICT,
  validity text NOT NULL DEFAULT 'Current' CHECK (validity IN ('Not Evaluated', 'Current', 'Impacted', 'Invalid')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (feature_id, phase, baseline_number),
  UNIQUE (phase, revision_id)
);

CREATE TABLE workbench_feature_artifact_validity_events (
  id uuid PRIMARY KEY,
  baseline_id uuid NOT NULL REFERENCES workbench_feature_artifact_baselines(id) ON DELETE RESTRICT,
  validity text NOT NULL CHECK (validity IN ('Not Evaluated', 'Current', 'Impacted', 'Invalid')),
  rationale text NOT NULL CHECK (btrim(rationale) <> ''),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workbench_feature_artifact_review_events (
  id uuid PRIMARY KEY,
  feature_id uuid NOT NULL REFERENCES workbench_features(id) ON DELETE RESTRICT,
  phase text NOT NULL CHECK (phase IN ('Specification', 'Solution Design', 'Verification Planning', 'Delivery Readiness')),
  revision_id uuid,
  from_state text NOT NULL,
  to_state text NOT NULL,
  actor_name text NOT NULL CHECK (btrim(actor_name) <> ''),
  rationale text NOT NULL CHECK (btrim(rationale) <> ''),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workbench_feature_artifact_approvals (
  id uuid PRIMARY KEY,
  baseline_id uuid NOT NULL REFERENCES workbench_feature_artifact_baselines(id) ON DELETE RESTRICT UNIQUE,
  actor_name text NOT NULL CHECK (btrim(actor_name) <> ''),
  rationale text NOT NULL CHECK (btrim(rationale) <> ''),
  warning_rationale text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workbench_work_packages (
  id uuid PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES workbench_products(id) ON DELETE RESTRICT,
  feature_id uuid NOT NULL REFERENCES workbench_features(id) ON DELETE RESTRICT,
  package_key text NOT NULL CHECK (btrim(package_key) <> ''),
  package_type text NOT NULL CHECK (package_type IN ('development', 'QA', 'other')),
  description text NOT NULL CHECK (btrim(description) <> ''),
  owning_team text,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, package_key)
);

CREATE TABLE workbench_work_package_predecessors (
  work_package_id uuid NOT NULL REFERENCES workbench_work_packages(id) ON DELETE RESTRICT,
  predecessor_work_package_id uuid NOT NULL REFERENCES workbench_work_packages(id) ON DELETE RESTRICT,
  PRIMARY KEY (work_package_id, predecessor_work_package_id),
  CHECK (work_package_id <> predecessor_work_package_id)
);

CREATE TABLE workbench_work_package_design_links (
  work_package_id uuid NOT NULL REFERENCES workbench_work_packages(id) ON DELETE RESTRICT,
  design_revision_id uuid NOT NULL REFERENCES workbench_design_revisions(id) ON DELETE RESTRICT,
  PRIMARY KEY (work_package_id, design_revision_id)
);

CREATE TABLE workbench_work_package_verification_links (
  work_package_id uuid NOT NULL REFERENCES workbench_work_packages(id) ON DELETE RESTRICT,
  verification_revision_id uuid NOT NULL REFERENCES workbench_verification_plan_revisions(id) ON DELETE RESTRICT,
  PRIMARY KEY (work_package_id, verification_revision_id)
);

CREATE TABLE workbench_deliverables (
  id uuid PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES workbench_products(id) ON DELETE RESTRICT,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workbench_deliverable_revisions (
  id uuid PRIMARY KEY,
  deliverable_id uuid NOT NULL REFERENCES workbench_deliverables(id) ON DELETE RESTRICT,
  revision_number integer NOT NULL CHECK (revision_number > 0),
  name text NOT NULL,
  description text NOT NULL,
  target_system text NOT NULL,
  target_environment text NOT NULL,
  artifact_revision_label text NOT NULL,
  target_release_train_id uuid,
  revision_state text NOT NULL DEFAULT 'Draft' CHECK (revision_state IN ('Draft', 'Approved', 'Superseded')),
  predecessor_revision_id uuid REFERENCES workbench_deliverable_revisions(id) ON DELETE RESTRICT,
  author_name text NOT NULL CHECK (btrim(author_name) <> ''),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (deliverable_id, revision_number),
  CHECK (target_release_train_id IS NULL)
);

CREATE UNIQUE INDEX workbench_one_deliverable_draft
  ON workbench_deliverable_revisions(deliverable_id) WHERE revision_state = 'Draft';

CREATE TABLE workbench_deliverable_readiness_conditions (
  revision_id uuid NOT NULL REFERENCES workbench_deliverable_revisions(id) ON DELETE RESTRICT,
  condition_key text NOT NULL CHECK (btrim(condition_key) <> ''),
  condition_text text NOT NULL CHECK (btrim(condition_text) <> ''),
  PRIMARY KEY (revision_id, condition_key)
);

CREATE TABLE workbench_feature_deliverables (
  feature_id uuid NOT NULL REFERENCES workbench_features(id) ON DELETE RESTRICT,
  deliverable_id uuid NOT NULL REFERENCES workbench_deliverables(id) ON DELETE RESTRICT,
  PRIMARY KEY (feature_id, deliverable_id)
);

CREATE TABLE workbench_deliverable_work_packages (
  deliverable_revision_id uuid NOT NULL REFERENCES workbench_deliverable_revisions(id) ON DELETE RESTRICT,
  work_package_id uuid NOT NULL REFERENCES workbench_work_packages(id) ON DELETE RESTRICT,
  PRIMARY KEY (deliverable_revision_id, work_package_id)
);

CREATE TABLE workbench_deliverable_dependencies (
  deliverable_revision_id uuid NOT NULL REFERENCES workbench_deliverable_revisions(id) ON DELETE RESTRICT,
  predecessor_deliverable_revision_id uuid NOT NULL REFERENCES workbench_deliverable_revisions(id) ON DELETE RESTRICT,
  PRIMARY KEY (deliverable_revision_id, predecessor_deliverable_revision_id),
  CHECK (deliverable_revision_id <> predecessor_deliverable_revision_id)
);

CREATE TABLE workbench_deliverable_approvals (
  id uuid PRIMARY KEY,
  deliverable_revision_id uuid NOT NULL REFERENCES workbench_deliverable_revisions(id) ON DELETE RESTRICT UNIQUE,
  actor_name text NOT NULL CHECK (btrim(actor_name) <> ''),
  rationale text NOT NULL CHECK (btrim(rationale) <> ''),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workbench_delivery_readiness_runs (
  id uuid PRIMARY KEY,
  feature_id uuid NOT NULL REFERENCES workbench_features(id) ON DELETE RESTRICT,
  feature_version integer NOT NULL,
  validator_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workbench_delivery_readiness_findings (
  id uuid PRIMARY KEY,
  validation_run_id uuid NOT NULL REFERENCES workbench_delivery_readiness_runs(id) ON DELETE RESTRICT,
  severity text NOT NULL CHECK (severity IN ('Blocker', 'Warning', 'Info')),
  code text NOT NULL,
  message text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workbench_delivery_readiness_baselines (
  id uuid PRIMARY KEY,
  feature_id uuid NOT NULL REFERENCES workbench_features(id) ON DELETE RESTRICT,
  baseline_number integer NOT NULL CHECK (baseline_number > 0),
  requirement_baseline_id uuid NOT NULL REFERENCES workbench_requirement_baselines(id) ON DELETE RESTRICT,
  specification_revision_id uuid NOT NULL REFERENCES workbench_specification_revisions(id) ON DELETE RESTRICT,
  design_revision_id uuid NOT NULL REFERENCES workbench_design_revisions(id) ON DELETE RESTRICT,
  verification_revision_id uuid NOT NULL REFERENCES workbench_verification_plan_revisions(id) ON DELETE RESTRICT,
  validation_run_id uuid NOT NULL REFERENCES workbench_delivery_readiness_runs(id) ON DELETE RESTRICT,
  validity text NOT NULL DEFAULT 'Current' CHECK (validity IN ('Not Evaluated', 'Current', 'Impacted', 'Invalid')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (feature_id, baseline_number)
);

CREATE TABLE workbench_delivery_readiness_baseline_work_packages (
  baseline_id uuid NOT NULL REFERENCES workbench_delivery_readiness_baselines(id) ON DELETE RESTRICT,
  work_package_id uuid NOT NULL REFERENCES workbench_work_packages(id) ON DELETE RESTRICT,
  work_package_version integer NOT NULL,
  PRIMARY KEY (baseline_id, work_package_id)
);

CREATE TABLE workbench_delivery_readiness_baseline_deliverables (
  baseline_id uuid NOT NULL REFERENCES workbench_delivery_readiness_baselines(id) ON DELETE RESTRICT,
  deliverable_revision_id uuid NOT NULL REFERENCES workbench_deliverable_revisions(id) ON DELETE RESTRICT,
  PRIMARY KEY (baseline_id, deliverable_revision_id)
);

CREATE TABLE workbench_delivery_readiness_approvals (
  id uuid PRIMARY KEY,
  baseline_id uuid NOT NULL REFERENCES workbench_delivery_readiness_baselines(id) ON DELETE RESTRICT UNIQUE,
  actor_name text NOT NULL CHECK (btrim(actor_name) <> ''),
  rationale text NOT NULL CHECK (btrim(rationale) <> ''),
  warning_rationale text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workbench_delivery_readiness_validity_events (
  id uuid PRIMARY KEY,
  baseline_id uuid NOT NULL REFERENCES workbench_delivery_readiness_baselines(id) ON DELETE RESTRICT,
  validity text NOT NULL CHECK (validity IN ('Not Evaluated', 'Current', 'Impacted', 'Invalid')),
  rationale text NOT NULL CHECK (btrim(rationale) <> ''),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX workbench_phase_states_feature_idx ON workbench_feature_phase_states(feature_id);
CREATE INDEX workbench_specifications_feature_idx ON workbench_specification_revisions(feature_id, revision_number DESC);
CREATE INDEX workbench_designs_feature_idx ON workbench_design_revisions(feature_id, revision_number DESC);
CREATE INDEX workbench_verification_plans_feature_idx ON workbench_verification_plan_revisions(feature_id, revision_number DESC);
CREATE INDEX workbench_work_packages_feature_idx ON workbench_work_packages(feature_id);
CREATE INDEX workbench_deliverables_product_idx ON workbench_deliverables(product_id);
CREATE INDEX workbench_feature_deliverables_feature_idx ON workbench_feature_deliverables(feature_id);
CREATE INDEX workbench_readiness_runs_feature_idx ON workbench_delivery_readiness_runs(feature_id, created_at DESC);

CREATE FUNCTION workbench_protect_phase2_revision() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.revision_state IN ('Approved', 'Superseded') THEN
    IF TG_OP = 'UPDATE'
       AND OLD.revision_state = 'Approved'
       AND NEW.revision_state = 'Superseded'
       AND to_jsonb(NEW) - 'revision_state' = to_jsonb(OLD) - 'revision_state' THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Approved and superseded Phase 2 revisions are immutable.' USING ERRCODE = '55000';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER workbench_specification_frozen_guard
BEFORE UPDATE OR DELETE ON workbench_specification_revisions
FOR EACH ROW EXECUTE FUNCTION workbench_protect_phase2_revision();
CREATE TRIGGER workbench_design_frozen_guard
BEFORE UPDATE OR DELETE ON workbench_design_revisions
FOR EACH ROW EXECUTE FUNCTION workbench_protect_phase2_revision();
CREATE TRIGGER workbench_verification_plan_frozen_guard
BEFORE UPDATE OR DELETE ON workbench_verification_plan_revisions
FOR EACH ROW EXECUTE FUNCTION workbench_protect_phase2_revision();
CREATE TRIGGER workbench_deliverable_frozen_guard
BEFORE UPDATE OR DELETE ON workbench_deliverable_revisions
FOR EACH ROW EXECUTE FUNCTION workbench_protect_phase2_revision();

CREATE FUNCTION workbench_reject_phase2_frozen_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Approved Phase 2 baseline, approval, or snapshot records are immutable.' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER workbench_artifact_baseline_guard BEFORE UPDATE OR DELETE ON workbench_feature_artifact_baselines FOR EACH ROW EXECUTE FUNCTION workbench_reject_phase2_frozen_mutation();
CREATE TRIGGER workbench_artifact_validity_guard BEFORE UPDATE OR DELETE ON workbench_feature_artifact_validity_events FOR EACH ROW EXECUTE FUNCTION workbench_reject_phase2_frozen_mutation();
CREATE TRIGGER workbench_artifact_approval_guard BEFORE UPDATE OR DELETE ON workbench_feature_artifact_approvals FOR EACH ROW EXECUTE FUNCTION workbench_reject_phase2_frozen_mutation();
CREATE TRIGGER workbench_deliverable_approval_guard BEFORE UPDATE OR DELETE ON workbench_deliverable_approvals FOR EACH ROW EXECUTE FUNCTION workbench_reject_phase2_frozen_mutation();
CREATE TRIGGER workbench_readiness_baseline_guard BEFORE UPDATE OR DELETE ON workbench_delivery_readiness_baselines FOR EACH ROW EXECUTE FUNCTION workbench_reject_phase2_frozen_mutation();
CREATE TRIGGER workbench_readiness_wp_guard BEFORE UPDATE OR DELETE ON workbench_delivery_readiness_baseline_work_packages FOR EACH ROW EXECUTE FUNCTION workbench_reject_phase2_frozen_mutation();
CREATE TRIGGER workbench_readiness_deliverable_guard BEFORE UPDATE OR DELETE ON workbench_delivery_readiness_baseline_deliverables FOR EACH ROW EXECUTE FUNCTION workbench_reject_phase2_frozen_mutation();
CREATE TRIGGER workbench_readiness_approval_guard BEFORE UPDATE OR DELETE ON workbench_delivery_readiness_approvals FOR EACH ROW EXECUTE FUNCTION workbench_reject_phase2_frozen_mutation();
CREATE TRIGGER workbench_readiness_validity_guard BEFORE UPDATE OR DELETE ON workbench_delivery_readiness_validity_events FOR EACH ROW EXECUTE FUNCTION workbench_reject_phase2_frozen_mutation();

CREATE FUNCTION workbench_protect_specification_child() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE revision_id_value uuid;
BEGIN
  revision_id_value := CASE WHEN TG_OP = 'DELETE' THEN OLD.revision_id ELSE NEW.revision_id END;
  IF EXISTS (SELECT 1 FROM workbench_specification_revisions WHERE id = revision_id_value AND revision_state IN ('Approved', 'Superseded')) THEN
    RAISE EXCEPTION 'Approved and superseded Specification revision content is immutable.' USING ERRCODE = '55000';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER workbench_specification_criteria_guard BEFORE INSERT OR UPDATE OR DELETE ON workbench_specification_acceptance_criteria FOR EACH ROW EXECUTE FUNCTION workbench_protect_specification_child();
CREATE TRIGGER workbench_specification_links_guard BEFORE INSERT OR UPDATE OR DELETE ON workbench_specification_requirement_links FOR EACH ROW EXECUTE FUNCTION workbench_protect_specification_child();

CREATE FUNCTION workbench_protect_criterion_requirement_link() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE criterion_id_value uuid;
BEGIN
  criterion_id_value := CASE WHEN TG_OP = 'DELETE' THEN OLD.criterion_id ELSE NEW.criterion_id END;
  IF EXISTS (
    SELECT 1 FROM workbench_specification_acceptance_criteria c
    JOIN workbench_specification_revisions r ON r.id = c.revision_id
    WHERE c.id = criterion_id_value AND r.revision_state IN ('Approved', 'Superseded')
  ) THEN
    RAISE EXCEPTION 'Approved and superseded Acceptance Criterion traces are immutable.' USING ERRCODE = '55000';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER workbench_criterion_requirement_links_guard BEFORE INSERT OR UPDATE OR DELETE ON workbench_acceptance_criterion_requirement_links FOR EACH ROW EXECUTE FUNCTION workbench_protect_criterion_requirement_link();

CREATE FUNCTION workbench_protect_design_child() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE revision_id_value uuid;
BEGIN
  revision_id_value := CASE WHEN TG_OP = 'DELETE' THEN OLD.revision_id ELSE NEW.revision_id END;
  IF EXISTS (SELECT 1 FROM workbench_design_revisions WHERE id = revision_id_value AND revision_state IN ('Approved', 'Superseded')) THEN
    RAISE EXCEPTION 'Approved and superseded Solution Design revision content is immutable.' USING ERRCODE = '55000';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER workbench_design_specification_links_guard BEFORE INSERT OR UPDATE OR DELETE ON workbench_design_specification_links FOR EACH ROW EXECUTE FUNCTION workbench_protect_design_child();
CREATE TRIGGER workbench_design_requirement_links_guard BEFORE INSERT OR UPDATE OR DELETE ON workbench_design_requirement_links FOR EACH ROW EXECUTE FUNCTION workbench_protect_design_child();
CREATE TRIGGER workbench_design_criterion_links_guard BEFORE INSERT OR UPDATE OR DELETE ON workbench_design_acceptance_criterion_links FOR EACH ROW EXECUTE FUNCTION workbench_protect_design_child();

CREATE FUNCTION workbench_protect_verification_case() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE revision_id_value uuid;
BEGIN
  revision_id_value := CASE WHEN TG_OP = 'DELETE' THEN OLD.revision_id ELSE NEW.revision_id END;
  IF EXISTS (SELECT 1 FROM workbench_verification_plan_revisions WHERE id = revision_id_value AND revision_state IN ('Approved', 'Superseded')) THEN
    RAISE EXCEPTION 'Approved and superseded Verification Plan revision content is immutable.' USING ERRCODE = '55000';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE FUNCTION workbench_protect_verification_link() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE case_id_value uuid;
BEGIN
  case_id_value := CASE WHEN TG_OP = 'DELETE' THEN OLD.case_id ELSE NEW.case_id END;
  IF EXISTS (
    SELECT 1 FROM workbench_verification_cases c
    JOIN workbench_verification_plan_revisions r ON r.id = c.revision_id
    WHERE c.id = case_id_value AND r.revision_state IN ('Approved', 'Superseded')
  ) THEN
    RAISE EXCEPTION 'Approved and superseded Verification Plan revision content is immutable.' USING ERRCODE = '55000';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER workbench_verification_cases_guard BEFORE INSERT OR UPDATE OR DELETE ON workbench_verification_cases FOR EACH ROW EXECUTE FUNCTION workbench_protect_verification_case();
CREATE TRIGGER workbench_verification_specification_links_guard BEFORE INSERT OR UPDATE OR DELETE ON workbench_verification_specification_links FOR EACH ROW EXECUTE FUNCTION workbench_protect_verification_link();
CREATE TRIGGER workbench_verification_requirement_links_guard BEFORE INSERT OR UPDATE OR DELETE ON workbench_verification_requirement_links FOR EACH ROW EXECUTE FUNCTION workbench_protect_verification_link();
CREATE TRIGGER workbench_verification_criterion_links_guard BEFORE INSERT OR UPDATE OR DELETE ON workbench_verification_acceptance_criterion_links FOR EACH ROW EXECUTE FUNCTION workbench_protect_verification_link();

CREATE FUNCTION workbench_protect_deliverable_condition() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE revision_id_value uuid;
BEGIN
  revision_id_value := CASE WHEN TG_OP = 'DELETE' THEN OLD.revision_id ELSE NEW.revision_id END;
  IF EXISTS (SELECT 1 FROM workbench_deliverable_revisions WHERE id = revision_id_value AND revision_state IN ('Approved', 'Superseded')) THEN
    RAISE EXCEPTION 'Approved and superseded Deliverable revision content is immutable.' USING ERRCODE = '55000';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER workbench_deliverable_conditions_guard BEFORE INSERT OR UPDATE OR DELETE ON workbench_deliverable_readiness_conditions FOR EACH ROW EXECUTE FUNCTION workbench_protect_deliverable_condition();

CREATE FUNCTION workbench_protect_deliverable_relationship() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE revision_id_value uuid;
BEGIN
  revision_id_value := CASE WHEN TG_OP = 'DELETE' THEN OLD.deliverable_revision_id ELSE NEW.deliverable_revision_id END;
  IF EXISTS (SELECT 1 FROM workbench_deliverable_revisions WHERE id = revision_id_value AND revision_state IN ('Approved', 'Superseded')) THEN
    RAISE EXCEPTION 'Approved Deliverable relationships are immutable; create a successor revision first.' USING ERRCODE = '55000';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER workbench_deliverable_packages_guard BEFORE INSERT OR UPDATE OR DELETE ON workbench_deliverable_work_packages FOR EACH ROW EXECUTE FUNCTION workbench_protect_deliverable_relationship();
CREATE TRIGGER workbench_deliverable_dependencies_guard BEFORE INSERT OR UPDATE OR DELETE ON workbench_deliverable_dependencies FOR EACH ROW EXECUTE FUNCTION workbench_protect_deliverable_relationship();

COMMIT;
