CREATE TABLE studio_identity (
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  owui_user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (issuer, subject),
  UNIQUE (owui_user_id)
);

CREATE TABLE studio_session (
  id_hash TEXT PRIMARY KEY,
  encrypted_payload TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  idle_expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX studio_session_expiry_idx ON studio_session(expires_at, idle_expires_at);
