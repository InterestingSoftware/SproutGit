ALTER TABLE hook_definitions
    ADD COLUMN execution_target TEXT NOT NULL DEFAULT 'trigger_worktree';

ALTER TABLE hook_definitions
    ADD COLUMN execution_mode TEXT NOT NULL DEFAULT 'headless';