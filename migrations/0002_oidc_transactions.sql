CREATE TABLE oidc_transaction (
  id_hash TEXT PRIMARY KEY,
  encrypted_payload TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX oidc_transaction_expiry_idx ON oidc_transaction(expires_at);
