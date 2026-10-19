BEGIN;

CREATE TABLE workbench_deliveries (
  id uuid PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES workbench_products(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (btrim(name) <> ''),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, name),
  UNIQUE (id, product_id)
);

CREATE TABLE workbench_planning_policy_revisions (
  id uuid PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES workbench_products(id) ON DELETE RESTRICT,
  revision_number integer NOT NULL CHECK (revision_number > 0),
  predecessor_revision_id uuid,
  rules jsonb NOT NULL CHECK (jsonb_typeof(rules) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, revision_number),
  UNIQUE (id, product_id),
  FOREIGN KEY (predecessor_revision_id, product_id) REFERENCES workbench_planning_policy_revisions(id, product_id) ON DELETE RESTRICT
);

CREATE TABLE workbench_planning_resources (
  id uuid PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES workbench_products(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (btrim(name) <> ''),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, name)
);

CREATE TABLE workbench_planning_resource_capacity (
  id uuid PRIMARY KEY,
  resource_id uuid NOT NULL REFERENCES workbench_planning_resources(id) ON DELETE RESTRICT,
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  units integer NOT NULL CHECK (units >= 0),
  CHECK (effective_to IS NULL OR effective_to > effective_from),
  UNIQUE (resource_id, effective_from)
);

CREATE TABLE workbench_planning_trains (
  id uuid PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES workbench_products(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (btrim(name) <> ''),
  cutoff_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, name)
);

CREATE TABLE workbench_planning_scenarios (
  id uuid PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES workbench_products(id) ON DELETE RESTRICT,
  delivery_id uuid NOT NULL,
  name text NOT NULL CHECK (btrim(name) <> ''),
  provenance text NOT NULL CHECK (provenance = 'manual'),
  cloned_from_revision_id uuid,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, name),
  UNIQUE (id, product_id),
  FOREIGN KEY (delivery_id, product_id) REFERENCES workbench_deliveries(id, product_id) ON DELETE RESTRICT
);

CREATE TABLE workbench_planning_scenario_revisions (
  id uuid PRIMARY KEY,
  scenario_id uuid NOT NULL,
  product_id uuid NOT NULL REFERENCES workbench_products(id) ON DELETE RESTRICT,
  delivery_id uuid NOT NULL,
  revision_number integer NOT NULL CHECK (revision_number > 0),
  predecessor_revision_id uuid,
  provenance text NOT NULL CHECK (provenance = 'manual'),
  input_hash text NOT NULL CHECK (input_hash ~ '^[0-9a-f]{64}$'),
  activities jsonb NOT NULL CHECK (jsonb_typeof(activities) = 'array'),
  deliverables jsonb NOT NULL CHECK (jsonb_typeof(deliverables) = 'array'),
  constraints jsonb NOT NULL CHECK (jsonb_typeof(constraints) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scenario_id, revision_number),
  UNIQUE (id, product_id),
  UNIQUE (id, scenario_id, product_id),
  FOREIGN KEY (scenario_id, product_id) REFERENCES workbench_planning_scenarios(id, product_id) ON DELETE RESTRICT,
  FOREIGN KEY (delivery_id, product_id) REFERENCES workbench_deliveries(id, product_id) ON DELETE RESTRICT,
  FOREIGN KEY (predecessor_revision_id, scenario_id, product_id) REFERENCES workbench_planning_scenario_revisions(id, scenario_id, product_id) ON DELETE RESTRICT
);

ALTER TABLE workbench_planning_scenarios
  ADD CONSTRAINT workbench_planning_clone_revision_fk
  FOREIGN KEY (cloned_from_revision_id, product_id) REFERENCES workbench_planning_scenario_revisions(id, product_id) ON DELETE RESTRICT;

CREATE TABLE workbench_planning_actuals (
  id uuid PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES workbench_products(id) ON DELETE RESTRICT,
  scenario_id uuid NOT NULL,
  activity_id uuid NOT NULL,
  kind text NOT NULL CHECK (btrim(kind) <> ''),
  value jsonb NOT NULL,
  observed_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (scenario_id, product_id) REFERENCES workbench_planning_scenarios(id, product_id) ON DELETE RESTRICT
);

CREATE TABLE workbench_planning_validation_runs (
  id uuid PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES workbench_products(id) ON DELETE RESTRICT,
  scenario_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  as_of timestamptz NOT NULL,
  validator_set_version text NOT NULL,
  input_hash text NOT NULL CHECK (input_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('verified', 'blocked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (scenario_id, product_id) REFERENCES workbench_planning_scenarios(id, product_id) ON DELETE RESTRICT,
  FOREIGN KEY (revision_id, product_id) REFERENCES workbench_planning_scenario_revisions(id, product_id) ON DELETE RESTRICT
);

CREATE TABLE workbench_planning_validation_findings (
  id text NOT NULL,
  validation_run_id uuid NOT NULL REFERENCES workbench_planning_validation_runs(id) ON DELETE RESTRICT,
  finding_status text NOT NULL CHECK (finding_status IN ('violated', 'unknown')),
  code text NOT NULL,
  message text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (validation_run_id, id)
);

CREATE INDEX workbench_deliveries_product_idx ON workbench_deliveries(product_id);
CREATE INDEX workbench_planning_policy_product_idx ON workbench_planning_policy_revisions(product_id, revision_number DESC);
CREATE INDEX workbench_planning_resources_product_idx ON workbench_planning_resources(product_id);
CREATE INDEX workbench_planning_trains_product_idx ON workbench_planning_trains(product_id);
CREATE INDEX workbench_planning_scenarios_product_idx ON workbench_planning_scenarios(product_id, updated_at DESC);
CREATE INDEX workbench_planning_revisions_scenario_idx ON workbench_planning_scenario_revisions(scenario_id, revision_number);
CREATE INDEX workbench_planning_actuals_scenario_idx ON workbench_planning_actuals(scenario_id, observed_at, recorded_at);
CREATE INDEX workbench_planning_validations_revision_idx ON workbench_planning_validation_runs(revision_id, created_at DESC);

CREATE FUNCTION workbench_reject_overlapping_capacity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM workbench_planning_resource_capacity existing
    WHERE existing.resource_id = NEW.resource_id
      AND existing.id <> NEW.id
      AND tstzrange(existing.effective_from, existing.effective_to, '[)') && tstzrange(NEW.effective_from, NEW.effective_to, '[)')
  ) THEN
    RAISE EXCEPTION 'Resource capacity periods must not overlap.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER workbench_planning_capacity_no_overlap
BEFORE INSERT OR UPDATE ON workbench_planning_resource_capacity
FOR EACH ROW EXECUTE FUNCTION workbench_reject_overlapping_capacity();

CREATE FUNCTION workbench_reject_planning_history_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Planning revisions, actuals, policies, and validation history are append-only.' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER workbench_planning_policy_immutable BEFORE UPDATE OR DELETE ON workbench_planning_policy_revisions FOR EACH ROW EXECUTE FUNCTION workbench_reject_planning_history_mutation();
CREATE TRIGGER workbench_planning_revision_immutable BEFORE UPDATE OR DELETE ON workbench_planning_scenario_revisions FOR EACH ROW EXECUTE FUNCTION workbench_reject_planning_history_mutation();
CREATE TRIGGER workbench_planning_actual_immutable BEFORE UPDATE OR DELETE ON workbench_planning_actuals FOR EACH ROW EXECUTE FUNCTION workbench_reject_planning_history_mutation();
CREATE TRIGGER workbench_planning_validation_run_immutable BEFORE UPDATE OR DELETE ON workbench_planning_validation_runs FOR EACH ROW EXECUTE FUNCTION workbench_reject_planning_history_mutation();
CREATE TRIGGER workbench_planning_validation_finding_immutable BEFORE UPDATE OR DELETE ON workbench_planning_validation_findings FOR EACH ROW EXECUTE FUNCTION workbench_reject_planning_history_mutation();

COMMIT;
