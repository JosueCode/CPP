-- Idempotent schema. Importing content never deletes reports or historical versions.
CREATE TABLE IF NOT EXISTS catalog_versions (
  version text PRIMARY KEY CHECK (length(version) BETWEEN 8 AND 128),
  metadata jsonb NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS catalog_active (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  version text NOT NULL REFERENCES catalog_versions(version),
  delivery_mode text NOT NULL DEFAULT 'public' CHECK (delivery_mode IN ('public','private'))
);
ALTER TABLE catalog_active ADD COLUMN IF NOT EXISTS delivery_mode text NOT NULL DEFAULT 'public' CHECK (delivery_mode IN ('public','private'));
CREATE TABLE IF NOT EXISTS content_entities (
  content_version text NOT NULL REFERENCES catalog_versions(version),
  kind text NOT NULL CHECK (kind IN ('word','reading','sense','contrast','scenario','exercise','example','relation','fixture','level','lesson')),
  id text NOT NULL CHECK (length(id) BETWEEN 1 AND 180),
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  PRIMARY KEY (content_version, kind, id)
);
CREATE TABLE IF NOT EXISTS content_links (
  content_version text NOT NULL,
  source_kind text NOT NULL,
  source_id text NOT NULL,
  relation text NOT NULL,
  target_kind text NOT NULL,
  target_id text NOT NULL,
  PRIMARY KEY (content_version,source_kind,source_id,relation,target_kind,target_id),
  FOREIGN KEY (content_version,source_kind,source_id) REFERENCES content_entities(content_version,kind,id),
  FOREIGN KEY (content_version,target_kind,target_id) REFERENCES content_entities(content_version,kind,id)
);
CREATE TABLE IF NOT EXISTS nuance_reports (
  id uuid PRIMARY KEY,
  content_version text NOT NULL,
  target_type text NOT NULL CHECK (target_type IN ('word','contrast','exercise')),
  target_kind text NOT NULL CHECK (target_kind IN ('word','contrast','exercise','fixture')),
  target_id text NOT NULL,
  reason text NOT NULL CHECK (reason IN ('meaning','naturalness','grammar','translation','answer','other')),
  comment text NOT NULL CHECK (length(comment) BETWEEN 10 AND 2000),
  contact text CHECK (length(contact) <= 120),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','reviewing','resolved','dismissed')),
  owner_note text NOT NULL DEFAULT '' CHECK (length(owner_note) <= 4000),
  received_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (content_version,target_kind,target_id) REFERENCES content_entities(content_version,kind,id)
);
CREATE INDEX IF NOT EXISTS reports_status_date_idx ON nuance_reports(status,received_at DESC);
CREATE TABLE IF NOT EXISTS report_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  report_id uuid NOT NULL REFERENCES nuance_reports(id),
  content_version text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  previous_status text,
  status text NOT NULL CHECK (status IN ('pending','reviewing','resolved','dismissed')),
  owner_note text NOT NULL DEFAULT '',
  correction_version text REFERENCES catalog_versions(version),
  changed_at timestamptz NOT NULL DEFAULT now()
);
