import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const readmePath = resolve(root, 'README.md');
const copilotInstructionsPath = resolve(root, '.github', 'copilot-instructions.md');

function readText(path) {
  return readFileSync(path, 'utf8');
}

function lineNumberAt(text, index) {
  return text.slice(0, index).split('\n').length;
}

function findMatches(text, regex) {
  const matches = [];
  for (const match of text.matchAll(regex)) {
    matches.push({
      index: match.index,
      value: match[0],
    });
  }
  return matches;
}

const readme = readText(readmePath);
const instructions = readText(copilotInstructionsPath);

const failures = [];

function forbidInReadme(regex, description) {
  const matches = findMatches(readme, regex);
  for (const match of matches) {
    failures.push(
      `README.md:${lineNumberAt(readme, match.index)} contains forbidden pattern (${description}): ${JSON.stringify(match.value)}`
    );
  }
}

function requireInInstructions(regex, description) {
  if (!regex.test(instructions)) {
    failures.push(`.github/copilot-instructions.md missing required guidance: ${description}`);
  }
}

function requireInReadme(regex, description) {
  if (!regex.test(readme)) {
    failures.push(`README.md missing required content: ${description}`);
  }
}

// README stale-content checks
forbidInReadme(/\bYOUR_USERNAME\b/g, 'placeholder clone URL token');
forbidInReadme(/once CI is set up/gi, 'stale CI setup phrasing');
forbidInReadme(/project\.json/g, 'removed workspace metadata file');

// Required anti-drift guardrails in Copilot instructions
requireInInstructions(
  /^## Documentation Drift Prevention \(Required\)$/m,
  'Documentation Drift Prevention section header'
);
requireInInstructions(
  /^### Tauri Commands \(Representative, Not Exhaustive\)$/m,
  'representative command coverage section'
);
requireInInstructions(
  /`src-tauri\/src\/lib\.rs` is the source of truth for registered Tauri commands/m,
  'backend source-of-truth statement'
);
requireInInstructions(
  /`src\/lib\/sproutgit\.ts` is the source of truth for frontend-callable API wrappers/m,
  'frontend API source-of-truth statement'
);

// README should keep docs entry point visible
requireInReadme(
  /\[docs\/index\.md\]\(docs\/index\.md\)/,
  'documentation entry point link to docs/index.md'
);

if (failures.length > 0) {
  console.error('Doc drift checks failed:\n');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('Doc drift checks passed.');
