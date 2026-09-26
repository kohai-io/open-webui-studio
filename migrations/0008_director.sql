CREATE TABLE studio_director_project (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  encrypted_document TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE INDEX director_project_owner ON studio_director_project(owner_id, updated_at DESC);
CREATE TABLE studio_director_revision (
  project_id TEXT NOT NULL REFERENCES studio_director_project(id),
  revision INTEGER NOT NULL,
  encrypted_document TEXT NOT NULL,
  PRIMARY KEY(project_id, revision)
);
CREATE TABLE studio_director_job (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES studio_director_project(id),
  owner_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  state TEXT NOT NULL,
  encrypted_payload TEXT NOT NULL,
  encrypted_credential TEXT,
  credential_expires_at INTEGER NOT NULL,
  claim_token TEXT,
  claim_until INTEGER,
  next_poll_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(owner_id, idempotency_key)
);
CREATE INDEX director_job_queue ON studio_director_job(state, next_poll_at, claim_until);
