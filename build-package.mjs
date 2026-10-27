import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, access, mkdtemp, cp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import vm from 'node:vm';

const root = dirname(fileURLToPath(import.meta.url));
// Explicit allowlist: aggressive files must never become defaults or enter the release.
const ruleNames = ['regex_ko.csv', 'regex_en.csv', 'regex_all.csv'];
const context = vm.createContext({});
vm.runInContext(await readFile(join(root, 'rules.js'), 'utf8'), context);
const tools = vm.runInContext('__MCS_RULES__', context);
const defaults = await Promise.all(ruleNames.map(async name => ({
  ...tools.parseFile(await readFile(join(root, 'rules', name), 'utf8'), {
    id: `default-${name}`, name, ...tools.inferFile(name)
  }),
  // The combined file is an alternative to the two language files, not a second pass.
  enabled: name !== 'regex_all.csv'
})));
const corePath = join(root, 'core.js');
const core = await readFile(corePath, 'utf8');
const marker = /(  \/\/ BEGIN BUNDLED RULES[^\n]*\n)[\s\S]*?(  \/\/ END BUNDLED RULES)/;
assert.match(core, marker);
const embedded = defaults.map(({ rules, ...file }) =>
  `    ${JSON.stringify(file).slice(0, -1)}, "rules": [\n${rules.map(rule => `      ${JSON.stringify(rule)}`).join(',\n')}\n    ]}`
).join(',\n');
await writeFile(corePath, core.replace(marker, (_, start, end) => `${start}  const DEFAULT_RULE_FILES = [\n${embedded}\n  ];\n${end}`));
if (process.argv.includes('--rules-only')) process.exit(0);

const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
const files = ['manifest.json', ...manifest.config.jsPath, manifest.config.cssPath,
  'LICENSE', 'THIRD-PARTY-NOTICES.txt', ...ruleNames.map(name => `rules/${name}`)];
const releases = join(root, '..', '..', 'releases');
await mkdir(releases, { recursive: true });
const output = join(releases, `chat-summary-calibrator-${manifest.config.version}.personal-extension.zip`);
try { await access(output); throw new Error(`Release already exists: ${output}`); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const staging = await mkdtemp(join(tmpdir(), 'chat-summary-calibrator-'));
try {
  for (const file of files) {
    await mkdir(dirname(join(staging, file)), { recursive: true });
    await cp(join(root, file), join(staging, file));
  }
  execFileSync('zip', ['-X', '-q', '-r', output, '.'], { cwd: staging });
} finally { await rm(staging, { recursive: true, force: true }); }
console.log(output);
