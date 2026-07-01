export { openConfigDb, type ConfigDb } from './config-db.js';
export { openWorkspaceDb, type WorkspaceDb } from './workspace-db.js';
export { getAgentRoster, saveAgentRoster, getDefaultAgentPresets } from './agents.js';
export * as configSchema from './schema/config.js';
export * as workspaceSchema from './schema/workspace.js';
// Re-export commonly used drizzle-orm query helpers so callers don't need
// a direct drizzle-orm dependency and avoid dual-instance type errors.
export { eq, and, or, asc, desc, sql } from 'drizzle-orm';
