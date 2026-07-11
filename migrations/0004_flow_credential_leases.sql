DROP INDEX studio_flow_credential_lease_expiry_idx;

CREATE TABLE studio_flow_credential_lease_v2 (
  execution_id TEXT PRIMARY KEY,
  owner_owui_user_id TEXT NOT NULL,
  encrypted_credential TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (execution_id, owner_owui_user_id),
  FOREIGN KEY (execution_id, owner_owui_user_id)
    REFERENCES studio_flow_execution(id, owner_owui_user_id) ON DELETE CASCADE
);

-- Leases are ephemeral bearer credentials. Rows created before execution-bound
-- associated data existed must be invalidated rather than migrated.
DROP TABLE studio_flow_credential_lease;
ALTER TABLE studio_flow_credential_lease_v2 RENAME TO studio_flow_credential_lease;

CREATE INDEX studio_flow_credential_lease_expiry_idx
  ON studio_flow_credential_lease(expires_at);

CREATE TRIGGER studio_flow_credential_lease_active_insert
BEFORE INSERT ON studio_flow_credential_lease
WHEN NOT EXISTS (
  SELECT 1 FROM studio_flow_execution
  WHERE id = NEW.execution_id
    AND owner_owui_user_id = NEW.owner_owui_user_id
    AND state IN ('queued', 'running')
)
BEGIN
  SELECT RAISE(ABORT, 'credential lease requires active execution');
END;

CREATE TRIGGER studio_flow_credential_lease_active_update
BEFORE UPDATE ON studio_flow_credential_lease
WHEN NOT EXISTS (
  SELECT 1 FROM studio_flow_execution
  WHERE id = NEW.execution_id
    AND owner_owui_user_id = NEW.owner_owui_user_id
    AND state IN ('queued', 'running')
)
BEGIN
  SELECT RAISE(ABORT, 'credential lease requires active execution');
END;

CREATE TRIGGER studio_flow_credential_lease_terminal_cleanup
AFTER UPDATE OF state ON studio_flow_execution
WHEN NEW.state IN ('cancel_requested', 'succeeded', 'failed', 'cancelled')
BEGIN
  DELETE FROM studio_flow_credential_lease
  WHERE execution_id = NEW.id AND owner_owui_user_id = NEW.owner_owui_user_id;
END;
