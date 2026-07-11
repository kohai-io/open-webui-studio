CREATE TABLE studio_agent (
    id TEXT PRIMARY KEY,
    owner_owui_user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    model_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX studio_agent_owner_idx ON studio_agent (owner_owui_user_id, updated_at DESC);
