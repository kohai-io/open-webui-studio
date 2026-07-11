ALTER TABLE studio_flow_execution ADD COLUMN claim_token_hash TEXT;
ALTER TABLE studio_flow_execution ADD COLUMN claim_attempt INTEGER NOT NULL DEFAULT 0
  CHECK (claim_attempt >= 0);
ALTER TABLE studio_flow_execution ADD COLUMN claim_expires_at INTEGER;

ALTER TABLE studio_flow_execution_node ADD COLUMN node_order INTEGER
  CHECK (node_order >= 1);

CREATE INDEX studio_flow_execution_ready_idx
  ON studio_flow_execution(state, created_at, id, owner_owui_user_id);

CREATE INDEX studio_flow_execution_stale_idx
  ON studio_flow_execution(state, claim_expires_at, id);

CREATE UNIQUE INDEX studio_flow_execution_node_order_idx
  ON studio_flow_execution_node(execution_id, node_order);

CREATE TRIGGER studio_flow_execution_terminal_clear_claim
AFTER UPDATE OF state ON studio_flow_execution
WHEN NEW.state IN ('succeeded', 'failed', 'cancelled')
BEGIN
  UPDATE studio_flow_execution
  SET claim_token_hash = NULL, claim_expires_at = NULL
  WHERE id = NEW.id;
END;

-- The foundation schema had no lifecycle service, node order, or worker claims.
-- Fail any pre-contract active rows closed instead of making them claimable.
UPDATE studio_flow_execution_node
SET state = 'failed', error_code = 'internal_error',
    finished_at = COALESCE(
      finished_at,
      (SELECT updated_at FROM studio_flow_execution
       WHERE id = studio_flow_execution_node.execution_id)
    )
WHERE execution_id IN (
  SELECT id FROM studio_flow_execution
  WHERE state IN ('queued', 'running', 'cancel_requested')
);

UPDATE studio_flow_execution
SET state = 'failed', error_code = 'internal_error',
    finished_at = COALESCE(finished_at, updated_at)
WHERE state IN ('queued', 'running', 'cancel_requested');
