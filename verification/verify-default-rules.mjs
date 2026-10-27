import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const context = vm.createContext({});
const manifest = JSON.parse(read('manifest.json'));
// Run the same initial script order as the packaged extension.
for (const name of manifest.config.jsPath.slice(0, 2)) vm.runInContext(read(name), context);
const core = vm.runInContext('__MCS_PHASE1_CORE__', context);
const rules = vm.runInContext('__MCS_RULES__', context);
const plain = value => JSON.parse(JSON.stringify(value));
const defaults = core.settingsFromStorage({});
assert.deepEqual(plain(defaults.ruleFiles.map(file => file.name)), ['regex_ko.csv', 'regex_en.csv', 'regex_all.csv']);
assert.deepEqual(plain(defaults.ruleFiles.map(file => file.enabled)), [true, true, false]);
assert.equal(defaults.correctionEnabled, false);
for (const file of defaults.ruleFiles) {
  assert.doesNotMatch(file.name, /aggressive/);
  const source = rules.parseFile(read(`rules/${file.name}`), { name: file.name, ...rules.inferFile(file.name) });
  assert.deepEqual(plain(file.rules), plain(source.rules), 'Embedded rules must match the supplied CSV exactly and in order');
}
const enabled = { ...defaults, correctionEnabled: true };
assert.equal(rules.apply('그는 집착했다.', defaults).text, '그는 집착했다.');
assert.equal(rules.apply('그는 집착했다.', enabled).text, '그는 강한 관심을 가졌다.');
assert.equal(rules.apply('obsession with clues', enabled).text, 'strong interest in clues');
assert.equal(rules.apply('집착 and obsession', enabled).text, '강한 관심 and strong interest');
const allOnly = { ...enabled, ruleFiles: defaults.ruleFiles.map(file => ({ ...file, enabled: file.language === 'all' })) };
assert.equal(rules.apply('집착 and obsession', allOnly).text, '강한 관심 and strong interest');
// Old empty settings get defaults; existing uploaded files/disabled states and the main switch survive.
const record = settings => ({ [core.STORAGE_KEY]: { schemaVersion: 1, settings } });
assert.equal(core.settingsFromStorage(record({ ruleFiles: [] })).ruleFiles.length, 3);
const custom = { name: 'custom.csv', enabled: false, type: 'replace', language: 'all', rules: [{ find: 'a', replace: 'b' }] };
const existing = core.settingsFromStorage(record({ correctionEnabled: true, ruleFiles: [custom] }));
assert.equal(existing.correctionEnabled, true); assert.deepEqual(plain(existing.ruleFiles), [custom]);
const deleted = core.settingsFromStorage(core.storagePatch({ ...defaults, ruleFiles: [] }));
assert.deepEqual(plain(deleted.ruleFiles), [], 'Deleting defaults is durable and must not reseed them');
const disabled = core.settingsFromStorage(core.storagePatch({ ...defaults, ruleFiles: defaults.ruleFiles.map(file => ({ ...file, enabled: false })) }));
assert.ok(disabled.ruleFiles.every(file => file.enabled === false));
defaults.ruleFiles[0].rules[0].replace = 'user edit';
assert.notEqual(core.settingsFromStorage({}).ruleFiles[0].rules[0].replace, 'user edit', 'Defaults must not share mutable settings');
console.log('Default CSV rules passed: exact source/order, no aggressive rules, language/mixed correction, combined alternative, old settings, deletion and disabled-state persistence.');
