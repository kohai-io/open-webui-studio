CREATE TABLE studio_flow (
  id TEXT PRIMARY KEY,
  owner_owui_user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  current_version INTEGER NOT NULL CHECK (current_version >= 1),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (id, owner_owui_user_id)
);

CREATE INDEX studio_flow_owner_updated_idx
  ON studio_flow(owner_owui_user_id, updated_at DESC, id);

CREATE TABLE studio_flow_version (
  flow_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  name TEXT NOT NULL,
  description TEXT,
  definition_json TEXT NOT NULL,
  definition_hash TEXT NOT NULL,
  owner_owui_user_id TEXT NOT NULL,
  created_by_owui_user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (flow_id, version),
  UNIQUE (flow_id, version, owner_owui_user_id),
  FOREIGN KEY (flow_id, owner_owui_user_id)
    REFERENCES studio_flow(id, owner_owui_user_id) ON DELETE CASCADE
);

CREATE TABLE studio_flow_execution (
  id TEXT PRIMARY KEY,
  flow_id TEXT NOT NULL,
  flow_version INTEGER NOT NULL,
  owner_owui_user_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (
    state IN ('queued', 'running', 'cancel_requested', 'succeeded', 'failed', 'cancelled')
  ),
  idempotency_key TEXT NOT NULL,
  encrypted_input TEXT,
  encrypted_output TEXT,
  error_code TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  heartbeat_at INTEGER,
  UNIQUE (owner_owui_user_id, idempotency_key),
  UNIQUE (id, owner_owui_user_id),
  FOREIGN KEY (flow_id, flow_version, owner_owui_user_id)
    REFERENCES studio_flow_version(flow_id, version, owner_owui_user_id) ON DELETE CASCADE
);

CREATE INDEX studio_flow_execution_owner_created_idx
  ON studio_flow_execution(owner_owui_user_id, created_at DESC, id);

CREATE INDEX studio_flow_execution_claim_idx
  ON studio_flow_execution(state, created_at, id);

CREATE TABLE studio_flow_execution_node (
  execution_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  node_type TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
  attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  started_at INTEGER,
  finished_at INTEGER,
  encrypted_payload TEXT,
  error_code TEXT,
  PRIMARY KEY (execution_id, node_id),
  FOREIGN KEY (execution_id) REFERENCES studio_flow_execution(id) ON DELETE CASCADE
);

CREATE TABLE studio_flow_credential_lease (
  execution_id TEXT PRIMARY KEY,
  encrypted_credential TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (execution_id) REFERENCES studio_flow_execution(id) ON DELETE CASCADE
);

CREATE INDEX studio_flow_credential_lease_expiry_idx
  ON studio_flow_credential_lease(expires_at);

CREATE TABLE studio_flow_event (
  execution_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence >= 1),
  owner_owui_user_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  node_id TEXT,
  node_type TEXT,
  state TEXT,
  error_code TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (execution_id, sequence),
  FOREIGN KEY (execution_id, owner_owui_user_id)
    REFERENCES studio_flow_execution(id, owner_owui_user_id) ON DELETE CASCADE
);

CREATE INDEX studio_flow_event_owner_idx
  ON studio_flow_event(owner_owui_user_id, execution_id, sequence);
