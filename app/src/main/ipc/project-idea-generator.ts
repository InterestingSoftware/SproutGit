/**
 * New-project-from-idea generator.
 *
 * Runs the user's default configured AI agent (see @sproutgit/types
 * AgentRoster/AgentRosterEntry, Settings → AI Agents) once, non-
 * interactively, to turn a free-form pitch into a project name, tech stack,
 * and one-line description. Spawned with `execFile` (never a shell), same
 * as the commit-message generator.
 *
 * The agent's normal command/args are tuned for interactive/ACP use (a
 * terminal session or a Chat-tab ACP connection), not a one-shot prompt —
 * so this maps the configured command to its verified non-interactive
 * invocation (the same per-CLI flags already vetted for the commit-message
 * generator's presets: see commit-message-generator.ts). A command not
 * recognized as one of those presets (e.g. Cursor, a fully custom binary,
 * or an e2e test double) instead falls back to the commit-message
 * generator's own model: spawn the configured command/args verbatim and
 * pipe the prompt over stdin. That's a best-effort guess for a CLI with no
 * verified one-shot flag — a genuinely interactive-only CLI will just run
 * until the timeout — but it's the same tradeoff already accepted for the
 * commit-message generator's "custom" preset, and it means any spawnable
 * command can be used here rather than only the four known presets.
 */
import { execFile } from 'node:child_process';
import { IPC, ACP_PRESET_TOKENS } from '@sproutgit/types';
import type { ProjectIdeaGenerateResult } from '@sproutgit/types';
import type { ConfigDb } from '@sproutgit/database';
import { getAgentRoster, resolveRosterAgent } from '@sproutgit/database';
import { handle } from './handle.js';
import { log } from '../telemetry.js';
import { splitCommand } from './tool-test-helpers.js';

const GENERATE_TIMEOUT_MS = 60_000;

const PROMPT_PREAMBLE = `You are helping set up a brand new software project from a short pitch.
Decide on a good project name and tech stack for it.
Respond with ONLY a single JSON object and nothing else — no markdown fences, no preamble, no trailing commentary — matching exactly this shape:
{"name": "kebab-case-folder-name", "techStack": "short tech stack summary, e.g. Next.js + TypeScript + Tailwind", "description": "one sentence describing what the project does"}

Project pitch:
`;

function commandToken(command: string): string {
  return splitCommand(command).bin.split(/[\\/]/).pop()?.toLowerCase() ?? '';
}

/** The argv/stdin to spawn — exactly one of `args` carrying the prompt positionally, or `stdin` piping it. */
type Invocation = { args: string[]; stdin?: string };

/**
 * Maps a recognized agent CLI to the argv that runs it non-interactively
 * with a single prompt and exits. Falls back to spawning the command as
 * configured with the prompt piped over stdin for anything not recognized —
 * see the module doc comment for why.
 */
function buildInvocation(command: string, baseArgs: string[], prompt: string): Invocation {
  const token = commandToken(command);
  if ((ACP_PRESET_TOKENS.claudeCode as readonly string[]).includes(token)) return { args: [...baseArgs, '-p', prompt] };
  if ((ACP_PRESET_TOKENS.gemini as readonly string[]).includes(token)) return { args: [...baseArgs, '-p', prompt] };
  if ((ACP_PRESET_TOKENS.codex as readonly string[]).includes(token)) return { args: [...baseArgs, 'exec', prompt] };
  if ((ACP_PRESET_TOKENS.kiro as readonly string[]).includes(token)) return { args: [...baseArgs, 'chat', '--no-interactive', prompt] };
  return { args: baseArgs, stdin: prompt };
}

/** Folder/branch-safe kebab-case slug, falling back to a generic name if nothing usable survives. */
function slugify(input: string): string {
  const slug = input.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'new-project';
}

/** Pulls the first `{...}` block out of the agent's stdout and parses it — agents sometimes wrap JSON in prose despite instructions. */
function extractJson(text: string): unknown {
  const match = /\{[\s\S]*\}/.exec(text);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

export function registerProjectIdeaGeneratorHandlers(configDb: ConfigDb): void {
  handle(IPC.PROJECT_IDEA_GENERATE, async (_e, args: { pitch: string }): Promise<ProjectIdeaGenerateResult> => {
    const pitch = args.pitch.trim();
    if (!pitch) return { error: 'Describe your project idea first.' };

    const agent = resolveRosterAgent(getAgentRoster(configDb));
    if (!agent.command.trim()) {
      return { error: 'No AI agent configured. Set one in Settings → AI Agents.' };
    }

    const { bin, args: leadingArgs } = splitCommand(agent.command);
    const invocation = buildInvocation(bin, [...leadingArgs, ...agent.args], `${PROMPT_PREAMBLE}${pitch}`);

    return new Promise<ProjectIdeaGenerateResult>(resolve => {
      let child: ReturnType<typeof execFile>;
      try {
        child = execFile(
          bin,
          invocation.args,
          { timeout: GENERATE_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024, env: { ...process.env, ...agent.env } },
          (error, stdout, stderr) => {
            if (error) {
              log.error('[projectIdea:generate] generator failed', error, stderr);
              resolve({ error: error.killed ? `Timed out after ${GENERATE_TIMEOUT_MS / 1000}s.` : (stderr.trim() || error.message) });
              return;
            }
            const parsed = extractJson(stdout);
            if (!parsed || typeof parsed !== 'object') {
              resolve({ error: 'The agent did not return a usable response.' });
              return;
            }
            const { name, techStack, description } = parsed as Record<string, unknown>;
            if (typeof name !== 'string' || typeof techStack !== 'string' || typeof description !== 'string') {
              resolve({ error: 'The agent response was missing expected fields.' });
              return;
            }
            resolve({ name: slugify(name), techStack: techStack.trim(), description: description.trim() });
          },
        );
      } catch (spawnErr) {
        log.error('[projectIdea:generate] failed to spawn generator', spawnErr);
        resolve({ error: spawnErr instanceof Error ? spawnErr.message : String(spawnErr) });
        return;
      }
      // A command that doesn't read stdin (the known-preset, positional-arg
      // path) can break the pipe when we close it; without a listener that
      // 'error' event would crash the process (same guard as commit-message-generator.ts).
      child.stdin?.on('error', () => undefined);
      if (invocation.stdin !== undefined) child.stdin?.write(invocation.stdin);
      child.stdin?.end();
    });
  });
}
