-- Migrate all existing headless hooks to terminal_tab now that headless mode
-- has been removed. Hooks that were already terminal_tab are unaffected.
UPDATE hook_definitions SET execution_mode = 'terminal_tab' WHERE execution_mode = 'headless';
