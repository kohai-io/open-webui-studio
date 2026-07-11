CREATE TABLE studio_flow_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_owui_user_id TEXT NOT NULL
        CHECK (length(owner_owui_user_id) BETWEEN 1 AND 256),
    action TEXT NOT NULL
        CHECK (action IN (
            'flow_created',
            'flow_updated',
            'flow_deleted',
            'execution_queued',
            'execution_started',
            'execution_requeued',
            'execution_cancel_requested',
            'execution_cancelled',
            'execution_succeeded',
            'execution_failed'
        )),
    flow_id TEXT NOT NULL CHECK (length(flow_id) BETWEEN 1 AND 128),
    flow_version INTEGER CHECK (flow_version IS NULL OR flow_version >= 1),
    execution_id TEXT CHECK (execution_id IS NULL OR length(execution_id) BETWEEN 1 AND 128),
    execution_state TEXT
        CHECK (execution_state IS NULL OR execution_state IN (
            'queued', 'running', 'succeeded', 'failed', 'cancel_requested', 'cancelled'
        )),
    error_code TEXT CHECK (error_code IS NULL OR length(error_code) BETWEEN 1 AND 64),
    created_at INTEGER NOT NULL
);

CREATE INDEX idx_studio_flow_audit_owner_created
    ON studio_flow_audit (owner_owui_user_id, created_at DESC, id DESC);

CREATE INDEX idx_studio_flow_audit_flow
    ON studio_flow_audit (flow_id, id DESC);

CREATE INDEX idx_studio_flow_audit_execution
    ON studio_flow_audit (execution_id, id DESC)
    WHERE execution_id IS NOT NULL;
