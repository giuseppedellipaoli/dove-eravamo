import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { run, START_MARKER, END_MARKER } from '../skills/dove-eravamo/scripts/project-context.mjs';

// Synthetic fixtures only: never inspect real projects, home directories or credentials.
const cacheRoot = path.resolve(process.env.DOVE_ERAVAMO_TEST_TMP || path.join(os.tmpdir(), 'dove-eravamo-tests'));
fs.mkdirSync(cacheRoot, { recursive: true });
function fixture(t, { seed = true } = {}) {
  const dir = fs.mkdtempSync(path.join(cacheRoot, 'context test-'));
  const write = (name, content) => {
    const filename = path.join(dir, name);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, content);
  };
  t.after(() => {
    assert.ok(path.resolve(dir).startsWith(cacheRoot + path.sep));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  if (seed) {
    write('AGENTS.md', '# Rules\nPreserve the explicit constraints.');
    write('STATUS.md', `${START_MARKER}\n<!-- ACTIVE_STEP: Docs/Steps/current.md -->\nCurrent checkpoint, pending review.\n${END_MARKER}\nHistorical detail that must stay outside the context.`);
    write('Docs/Steps/current.md', '# Current work\nImplement the selected task only.');
    write('Docs/Steps/future.md', '# Future work\nUnselected future task.');
    write('Docs/Example.md', '# Parent\nPrecondition\n## Pick\nDo NOT copy.\n### Child\nRequired clause\n## Next\nOther clause');
  }
  return { dir, write };
}
function current(write, body, history = '') {
  write('STATUS.md', `${START_MARKER}\n${body}\n${END_MARKER}\n${history}`);
}
function snapshot(dir) {
  const entries = [];
  function walk(base, prefix = '') {
    for (const name of fs.readdirSync(base).sort()) {
      const filename = path.join(base, name), relative = prefix + name, stat = fs.lstatSync(filename);
      if (stat.isSymbolicLink()) entries.push([relative, 'link', fs.readlinkSync(filename)]);
      else if (stat.isDirectory()) { entries.push([relative, 'dir']); walk(filename, relative + '/'); }
      else entries.push([relative, createHash('sha256').update(fs.readFileSync(filename)).digest('hex')]);
    }
  }
  walk(dir);
  return entries;
}
function failsWithoutContent(action, forbidden) {
  assert.throws(action, error => {
    assert.ok(error instanceof Error);
    if (forbidden) assert.ok(!error.message.includes(forbidden), 'Errors must not expose document contents.');
    return true;
  });
}
function provenance(output) {
  const match = output.match(/SHA256\s+([a-f0-9]{64})/i);
  assert.ok(match, 'A document excerpt must carry its complete SHA-256 hash.');
  return match[1];
}

test('start includes rules, the current checkpoint and the explicit active document', t => {
  const { dir } = fixture(t), output = run(['start'], dir);
  for (const text of ['Preserve the explicit constraints.', 'Current checkpoint, pending review.', 'Implement the selected task only.']) assert.ok(output.includes(text));
  assert.ok(!output.includes('Historical detail that must stay outside the context.'));
  assert.ok(!output.includes('Unselected future task.'));
  provenance(output);
  assert.ok(output.length <= 32000);
});
test('empty arguments use start and optional AGENTS can be absent', t => {
  const { dir } = fixture(t);
  fs.unlinkSync(path.join(dir, 'AGENTS.md'));
  assert.equal(run([], dir), run(['start'], dir));
  assert.ok(run([], dir).includes('Current checkpoint, pending review.'));
});
test('current returns the checkpoint alone even when the selected document is missing', t => {
  const { dir } = fixture(t);
  fs.unlinkSync(path.join(dir, 'Docs/Steps/current.md'));
  const output = run(['current'], dir);
  assert.ok(output.includes('Current checkpoint, pending review.'));
  assert.ok(!output.includes('Preserve the explicit constraints.'));
  assert.ok(!output.includes('Historical detail that must stay outside the context.'));
  assert.throws(() => run(['start'], dir));
});
test('a small unmarked status is used as a complete checkpoint', t => {
  const { dir, write } = fixture(t);
  write('STATUS.md', '# Progress\nKeep this complete status.\nThe work is not yet accepted.');
  for (const command of ['start', 'current']) {
    const output = run([command], dir);
    assert.ok(output.includes('Keep this complete status.'));
    assert.ok(output.includes('The work is not yet accepted.'));
  }
});
test('partial, duplicate or reversed current markers fail closed', t => {
  const { dir, write } = fixture(t);
  for (const content of [START_MARKER, END_MARKER, `${START_MARKER}\n${START_MARKER}\n${END_MARKER}`, `${START_MARKER}\n${END_MARKER}\n${END_MARKER}`, `${END_MARKER}\n${START_MARKER}`]) {
    write('STATUS.md', content);
    for (const command of ['start', 'current']) assert.throws(() => run([command], dir));
  }
});
test('fenced examples of markers and pointers never select documents', t => {
  const { dir, write } = fixture(t);
  write('STATUS.md', ['```md', START_MARKER, '<!-- ACTIVE_STEP: Docs/Steps/does-not-exist.md -->', END_MARKER, '```', START_MARKER, '<!-- ACTIVE_STEP: Docs/Steps/current.md -->', 'Live checkpoint.', '~~~md', START_MARKER, '<!-- ACTIVE_STEP: ../outside.md -->', END_MARKER, '~~~', END_MARKER].join('\n'));
  const output = run(['start'], dir);
  assert.ok(output.includes('Live checkpoint.'));
  assert.ok(output.includes('Implement the selected task only.'));
});
test('an absent active pointer is allowed and archived pointers are never inferred', t => {
  const { dir, write } = fixture(t);
  current(write, 'Waiting for the next explicit task.', '<!-- ACTIVE_STEP: Docs/Steps/future.md -->');
  const output = run(['start'], dir);
  assert.ok(output.includes('Waiting for the next explicit task.'));
  assert.ok(!output.includes('Unselected future task.'));
  assert.ok(!output.includes('Implement the selected task only.'));
});
test('duplicate or unsafe active pointers fail instead of choosing a document', t => {
  const { dir, write } = fixture(t), pointer = '<!-- ACTIVE_STEP: Docs/Steps/current.md -->';
  for (const body of [`${pointer}\n${pointer}`, '<!-- ACTIVE_STEP: ../outside.md -->', '<!-- ACTIVE_STEP: C:/outside.md -->', '<!-- ACTIVE_STEP: Docs/Steps/current.md:stream -->']) {
    current(write, body);
    assert.throws(() => run(['start'], dir));
  }
});
test('missing explicit documents fail and active selection is always read fresh', t => {
  const { dir, write } = fixture(t);
  current(write, '<!-- ACTIVE_STEP: Docs/Steps/missing.md -->');
  assert.throws(() => run(['start'], dir));
  current(write, '<!-- ACTIVE_STEP: Docs/Steps/current.md -->');
  assert.ok(run(['start'], dir).includes('Implement the selected task only.'));
  current(write, '<!-- ACTIVE_STEP: Docs/Steps/future.md -->');
  const output = run(['start'], dir);
  assert.ok(output.includes('Unselected future task.'));
  assert.ok(!output.includes('Implement the selected task only.'));
});
test('sections retain negations, child clauses and original line numbers', t => {
  const { dir } = fixture(t), output = run(['section', 'Docs/Example.md', 'Pick'], dir);
  assert.match(output, /3: ## Pick\n4: Do NOT copy\.\n5: ### Child\n6: Required clause/);
  assert.ok(!output.includes('Other clause'));
  assert.ok(!output.includes('Precondition'));
  provenance(output);
});
test('headings ignore fenced code and shorter fences inside longer blocks', t => {
  const { dir, write } = fixture(t);
  write('Docs/Example.md', '# Real\n````md\n## Fake\n```\n### Still fake\n````\n~~~\n# Also fake\n~~~\n## Visible ###');
  const output = run(['headings', 'Docs/Example.md'], dir);
  for (const title of ['Real', 'Visible']) assert.ok(output.includes(title));
  for (const title of ['Fake', 'Still fake', 'Also fake']) assert.ok(!output.includes(title));
});
test('missing, duplicate or inexact headings require an explicit read', t => {
  const { dir, write } = fixture(t);
  write('Docs/Example.md', '## Same\na\n## Same\nb');
  for (const heading of ['Same', 'Missing', 'same']) assert.throws(() => run(['section', 'Docs/Example.md', heading], dir));
});
test('CRLF, UTF-8 BOM and Unicode survive excerpts and line numbering', t => {
  const { dir, write } = fixture(t);
  write('Notes/Decisioni café.md', '\uFEFF# Perché\r\n## Già fatto\r\nNon è approvato: manca l’ultimo test.\r\n### 次\r\nConservare ☕\r\n## Dopo\r\nAltro');
  const output = run(['section', 'Notes/Decisioni café.md', 'Già fatto'], dir);
  assert.match(output, /2: ## Già fatto\n3: Non è approvato: manca l’ultimo test\.\n4: ### 次\n5: Conservare ☕/);
  assert.ok(!output.includes('\r'));
  assert.ok(!output.includes('Altro'));
});
test('new reads see new bytes and a matching changed SHA-256', t => {
  const { dir, write } = fixture(t), before = run(['lines', 'Docs/Example.md', '1', '2'], dir);
  write('Docs/Example.md', '# Changed\nNew truth');
  const after = run(['lines', 'Docs/Example.md', '1', '2'], dir);
  assert.notEqual(provenance(before), provenance(after));
  assert.ok(after.includes('New truth'));
  assert.equal(provenance(after), createHash('sha256').update(fs.readFileSync(path.join(dir, 'Docs/Example.md'))).digest('hex'));
});
test('line arguments must be positive safe integers; continuation and EOF are explicit', t => {
  const { dir } = fixture(t);
  for (const start of ['0', '-1', '1.5', '1e1', '+1', 'word', '999', '9007199254740992']) assert.throws(() => run(['lines', 'Docs/Example.md', start, '1'], dir));
  for (const count of ['0', '-1', '1.5', 'word', '9007199254740992']) assert.throws(() => run(['lines', 'Docs/Example.md', '1', count], dir));
  assert.match(run(['lines', 'Docs/Example.md', '1', '2'], dir), /(?:next line|prossima riga)\s+3/i);
  assert.match(run(['lines', 'Docs/Example.md', '7', '99'], dir), /EOF/i);
});
test('traversal, absolute paths, ADS and non-Markdown access are rejected', t => {
  const { dir } = fixture(t);
  for (const requested of ['../AGENTS.md', 'Docs/../AGENTS.md', './AGENTS.md', 'C:/secret.md', '/secret.md', '\\\\server\\share\\secret.md', 'Docs/Example.md:secret', 'Docs/Example.md\0', 'source.js', 'notes.csv', 'https://example.invalid/readme.md']) assert.throws(() => run(['headings', requested], dir), requested);
});
test('sensitive paths are rejected case-insensitively even when documents exist', t => {
  const { dir, write } = fixture(t);
  for (const name of ['.git/README.md', 'node_modules/README.md', '.env/README.md', '.env.md', 'vendor/README.md', 'venv/README.md', '.venv/README.md', 'credentials.md', 'SECRETS.MD', 'Docs/private-key.md']) {
    write(name, '# Private\nSynthetic sensitive content.');
    failsWithoutContent(() => run(['lines', name, '1', '2'], dir), 'Synthetic sensitive content.');
  }
});
test('directory links cannot escape the project', t => {
  const { dir } = fixture(t), { dir: outside, write } = fixture(t);
  write('Outside.md', '# External\nDo not disclose the external fixture.');
  fs.symlinkSync(outside, path.join(dir, 'Docs/Outside'), process.platform === 'win32' ? 'junction' : 'dir');
  failsWithoutContent(() => run(['lines', 'Docs/Outside/Outside.md', '1', '2'], dir), 'Do not disclose the external fixture.');
});
test('internal links cannot bypass sensitive canonical target checks', t => {
  const { dir, write } = fixture(t);
  write('.git/hidden.md', '# Private\nDo not disclose hidden internals.');
  fs.symlinkSync(path.join(dir, '.git'), path.join(dir, 'Docs/Linked'), process.platform === 'win32' ? 'junction' : 'dir');
  failsWithoutContent(() => run(['lines', 'Docs/Linked/hidden.md', '1', '2'], dir), 'Do not disclose hidden internals.');
});
test('binary documents and files over 2 MiB fail without their contents', t => {
  const { dir, write } = fixture(t);
  write('Docs/Binary.md', '# Synthetic binary\ncontains\0null');
  failsWithoutContent(() => run(['headings', 'Docs/Binary.md'], dir), 'contains');
  write('Docs/Huge.md', '# Huge\n' + 'private-payload-'.repeat(150000));
  failsWithoutContent(() => run(['lines', 'Docs/Huge.md', '1', '1'], dir), 'private-payload-');
});
test('individual or aggregate output over 32000 characters fails without partial content', t => {
  const { dir, write } = fixture(t);
  write('Docs/Example.md', '# Long\n' + 'payload-never-returned-'.repeat(1600));
  failsWithoutContent(() => run(['section', 'Docs/Example.md', 'Long'], dir), 'payload-never-returned-');
  write('AGENTS.md', '# Rules\n' + 'a'.repeat(17000));
  current(write, 'b'.repeat(17000));
  failsWithoutContent(() => run(['start'], dir), 'bbbbbbbbbbbbbbbbbbbb');
});
test('without status, start reports the missing checkpoint and never mines archives', t => {
  const { dir, write } = fixture(t);
  fs.unlinkSync(path.join(dir, 'STATUS.md'));
  write('archive/old-status.md', '# Current\nInvented active work from a stale archive.');
  const output = run(['start'], dir);
  assert.match(output, /checkpoint|STATUS\.md/i);
  for (const text of ['Invented active work from a stale archive.', 'Implement the selected task only.', 'Unselected future task.']) assert.ok(!output.includes(text));
});
test('ordinary start writes no files and opens no network connections', t => {
  const { dir, write } = fixture(t);
  write('AGENTS.md', '# Rules\nReference only: https://example.invalid/no-network');
  const before = snapshot(dir), originals = [globalThis.fetch, http.request, https.request, net.connect];
  const fail = () => { throw new Error('Unexpected network access in a local context read.'); };
  try {
    globalThis.fetch = fail; http.request = fail; https.request = fail; net.connect = fail;
    assert.ok(run(['start'], dir).includes('Current checkpoint, pending review.'));
  } finally {
    [globalThis.fetch, http.request, https.request, net.connect] = originals;
  }
  assert.deepEqual(snapshot(dir), before);
});
test('root and status flags work in different positions with spaced root paths', t => {
  const { dir, write } = fixture(t);
  write('Notes/Progress.md', '# Status\nExplicit alternate checkpoint.');
  for (const args of [['--root', dir, 'current', '--status', 'Notes/Progress.md'], ['current', '--status', 'Notes/Progress.md', '--root', dir], ['--status', 'Notes/Progress.md', 'current', '--root', dir]]) {
    const output = run(args, path.join(dir, 'does-not-exist'));
    assert.ok(output.includes('Explicit alternate checkpoint.'));
    assert.ok(!output.includes('Current checkpoint, pending review.'));
  }
});
test('malformed flags, extra arguments and unsafe status destinations fail', t => {
  const { dir } = fixture(t);
  for (const args of [['--root'], ['--status'], ['--unknown'], ['start', 'extra'], ['current', 'extra'], ['headings'], ['headings', 'Docs/Example.md', 'extra'], ['section', 'Docs/Example.md'], ['lines', 'Docs/Example.md', '1'], ['lines', 'Docs/Example.md', '1', '1', 'extra'], ['--status', '../STATUS.md', 'start'], ['start', '--status', 'C:/STATUS.md'], ['--root', path.join(dir, 'AGENTS.md'), 'start']]) assert.throws(() => run(args, dir), JSON.stringify(args));
});
test('help and version work without a project', t => {
  const { dir } = fixture(t, { seed: false });
  for (const flag of ['--help', '-h']) assert.match(run([flag], dir), /start|current|init/);
  assert.match(run(['--version'], dir), /\b\d+\.\d+\.\d+\b/);
});
test('init writes one minimal checkpoint and never overwrites it', t => {
  const { dir } = fixture(t, { seed: false });
  run(['init'], dir);
  assert.deepEqual(fs.readdirSync(dir), ['STATUS.md']);
  const created = fs.readFileSync(path.join(dir, 'STATUS.md'), 'utf8');
  assert.ok(created.includes(START_MARKER));
  assert.ok(created.includes(END_MARKER));
  assert.ok(run(['start'], dir).length > 0);
  const before = snapshot(dir);
  assert.throws(() => run(['init'], dir));
  assert.deepEqual(snapshot(dir), before);
});
test('init accepts a custom destination but never creates missing parent directories', t => {
  const { dir, write } = fixture(t, { seed: false });
  write('Notes/keep.md', '# Existing note');
  run(['--status', 'Notes/Progress.md', 'init'], dir);
  assert.ok(fs.existsSync(path.join(dir, 'Notes/Progress.md')));
  assert.ok(!fs.existsSync(path.join(dir, 'STATUS.md')));
  const before = snapshot(dir);
  assert.throws(() => run(['init', '--status', 'missing/Progress.md'], dir));
  assert.deepEqual(snapshot(dir), before);
});
// Fixture setup must not leave background Git maintenance racing the read-only snapshots.
let gitAvailable = false;
try { gitAvailable = /git version/.test(execFileSync('git', ['--version'], { encoding: 'utf8', windowsHide: true })); } catch {}
test('start shows local Git facts and preserves all repository files', { skip: !gitAvailable }, t => {
  const { dir, write } = fixture(t);
  const gitEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_OPTIONAL_LOCKS: '0' };
  const git = (...args) => execFileSync('git', ['-c', 'gc.auto=0', '-c', 'maintenance.auto=false', ...args], { cwd: dir, env: gitEnv, encoding: 'utf8', windowsHide: true });
  git('-c', 'init.defaultBranch=main', '-c', 'init.templateDir=', 'init', '--quiet');
  git('add', '--', '.');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'Synthetic initial state');
  write('Docs/Example.md', '# Local modified document');
  write('Local-untracked.md', '# Local untracked document');
  const before = snapshot(dir);
  const originalGlobal = process.env.GIT_CONFIG_GLOBAL, originalNoSystem = process.env.GIT_CONFIG_NOSYSTEM;
  let output;
  try {
    process.env.GIT_CONFIG_GLOBAL = gitEnv.GIT_CONFIG_GLOBAL;
    process.env.GIT_CONFIG_NOSYSTEM = '1';
    output = run(['start'], dir);
  } finally {
    if (originalGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = originalGlobal;
    if (originalNoSystem === undefined) delete process.env.GIT_CONFIG_NOSYSTEM;
    else process.env.GIT_CONFIG_NOSYSTEM = originalNoSystem;
  }
  assert.match(output, /git/i);
  assert.ok(output.includes('Docs/Example.md'));
  assert.ok(output.includes('Local-untracked.md'));
  assert.deepEqual(snapshot(dir), before);
  assert.equal(git('remote').trim(), '');
});

test('Git filters never execute during start; unsafe working-tree status is skipped explicitly', { skip: !gitAvailable }, t => {
  const { dir, write } = fixture(t);
  const emptyGlobalConfig = path.join(dir, 'empty-global.gitconfig');
  write('empty-global.gitconfig', '');
  const gitEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: emptyGlobalConfig, GIT_OPTIONAL_LOCKS: '0' };
  const git = (...args) => execFileSync('git', ['-c', 'gc.auto=0', '-c', 'maintenance.auto=false', ...args], { cwd: dir, env: gitEnv, encoding: 'utf8', windowsHide: true });
  git('-c', 'init.defaultBranch=main', '-c', 'init.templateDir=', 'init', '--quiet');
  write('filter.cjs', "const fs = require('node:fs'); fs.writeFileSync('filter-ran.sentinel', 'filter executed'); process.stdout.write(fs.readFileSync(0));\n");
  write('.gitattributes', '*.filtered filter=sentinel\n');
  write('tracked.filtered', 'first\n');
  const nodeExe = process.execPath.replaceAll('\\', '/').replaceAll('"', '\\"');
  git('config', '--local', 'filter.sentinel.clean', `"${nodeExe}" filter.cjs`);
  git('add', '--', '.');
  const sentinel = path.join(dir, 'filter-ran.sentinel');
  assert.ok(fs.existsSync(sentinel), 'The fixture must demonstrate that its clean filter really executes.');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'Synthetic filter fixture');
  fs.rmSync(sentinel, { force: true });
  write('tracked.filtered', 'other\n');
  const changedTime = new Date(Date.now() + 5000);
  fs.utimesSync(path.join(dir, 'tracked.filtered'), changedTime, changedTime);
  const before = snapshot(dir);
  const originalGlobal = process.env.GIT_CONFIG_GLOBAL, originalNoSystem = process.env.GIT_CONFIG_NOSYSTEM;
  let output;
  try {
    process.env.GIT_CONFIG_GLOBAL = emptyGlobalConfig;
    process.env.GIT_CONFIG_NOSYSTEM = '1';
    output = run(['start'], dir);
  } finally {
    if (originalGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = originalGlobal;
    if (originalNoSystem === undefined) delete process.env.GIT_CONFIG_NOSYSTEM;
    else process.env.GIT_CONFIG_NOSYSTEM = originalNoSystem;
  }
  assert.ok(!fs.existsSync(sentinel), 'A read-only context request must never execute a configured Git clean/process filter.');
  assert.deepEqual(snapshot(dir), before);
  assert.match(output, /filter/i);
  assert.match(output, /skip|omess|saltat/i);
  assert.match(output, /\bmain\b/, 'Branch facts remain available even when working-tree status is skipped.');
});

test('repository redirect environment cannot expose an unrelated Git working tree', { skip: !gitAvailable }, t => {
  const { dir, write } = fixture(t);
  const { dir: foreignDir, write: foreignWrite } = fixture(t, { seed: false });
  write('empty-global.gitconfig', '');
  const emptyGlobalConfig = path.join(dir, 'empty-global.gitconfig');
  const gitEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: emptyGlobalConfig, GIT_OPTIONAL_LOCKS: '0' };
  const foreignGit = (...args) => execFileSync('git', ['-c', 'gc.auto=0', '-c', 'maintenance.auto=false', ...args], { cwd: foreignDir, env: gitEnv, encoding: 'utf8', windowsHide: true });
  foreignGit('-c', 'init.defaultBranch=foreign-fixture', '-c', 'init.templateDir=', 'init', '--quiet');
  foreignWrite('Foreign-only-sensitive.md', '# Foreign repository\nDo not expose this unrelated project.');
  foreignGit('add', '--', 'Foreign-only-sensitive.md');
  const redirectedEnv = {
    GIT_DIR: path.join(foreignDir, '.git'), GIT_WORK_TREE: foreignDir,
    GIT_INDEX_FILE: path.join(foreignDir, '.git/index'),
    GIT_CONFIG_GLOBAL: emptyGlobalConfig, GIT_CONFIG_NOSYSTEM: '1',
  };
  const demonstratedLeak = execFileSync('git', ['status', '--porcelain'], { cwd: dir, env: { ...gitEnv, ...redirectedEnv }, encoding: 'utf8', windowsHide: true });
  assert.ok(demonstratedLeak.includes('Foreign-only-sensitive.md'), 'The fixture must demonstrate the repository redirect.');
  const before = snapshot(dir), foreignBefore = snapshot(foreignDir);
  const originals = new Map(Object.keys(redirectedEnv).map(key => [key, process.env[key]]));
  let output;
  try {
    Object.assign(process.env, redirectedEnv);
    output = run(['start'], dir);
  } finally {
    for (const [key, value] of originals) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  assert.match(output, /Git.*unavailable/i);
  assert.ok(!output.includes('Foreign-only-sensitive.md'));
  assert.ok(!output.includes('foreign-fixture'));
  assert.ok(!output.includes('Do not expose this unrelated project.'));
  assert.deepEqual(snapshot(dir), before);
  assert.deepEqual(snapshot(foreignDir), foreignBefore);
});

test('unused configured Git filters do not hide ordinary working-tree changes', { skip: !gitAvailable }, t => {
  const { dir, write } = fixture(t);
  write('empty-global.gitconfig', '');
  const emptyGlobalConfig = path.join(dir, 'empty-global.gitconfig');
  const gitEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: emptyGlobalConfig, GIT_OPTIONAL_LOCKS: '0' };
  const git = (...args) => execFileSync('git', ['-c', 'gc.auto=0', '-c', 'maintenance.auto=false', ...args], { cwd: dir, env: gitEnv, encoding: 'utf8', windowsHide: true });
  git('-c', 'init.defaultBranch=main', '-c', 'init.templateDir=', 'init', '--quiet');
  write('filter.cjs', "const fs = require('node:fs'); fs.writeFileSync('filter-ran.sentinel', 'filter executed'); process.stdout.write(fs.readFileSync(0));\n");
  const nodeExe = process.execPath.replaceAll('\\', '/').replaceAll('"', '\\"');
  git('config', '--local', 'filter.unused.clean', `"${nodeExe}" filter.cjs`);
  git('add', '--', '.');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'Synthetic unused filter fixture');
  const sentinel = path.join(dir, 'filter-ran.sentinel');
  assert.ok(!fs.existsSync(sentinel), 'No attributes select this configured filter.');
  write('Docs/Example.md', '# A locally modified document that uses no content filter');
  const before = snapshot(dir);
  const originalGlobal = process.env.GIT_CONFIG_GLOBAL, originalNoSystem = process.env.GIT_CONFIG_NOSYSTEM;
  let output;
  try {
    process.env.GIT_CONFIG_GLOBAL = emptyGlobalConfig;
    process.env.GIT_CONFIG_NOSYSTEM = '1';
    output = run(['start'], dir);
  } finally {
    if (originalGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = originalGlobal;
    if (originalNoSystem === undefined) delete process.env.GIT_CONFIG_NOSYSTEM;
    else process.env.GIT_CONFIG_NOSYSTEM = originalNoSystem;
  }
  assert.ok(output.includes('Docs/Example.md'), 'An unused filter must not suppress useful local working-tree status.');
  assert.doesNotMatch(output, /working.tree status skipped/i);
  assert.ok(!fs.existsSync(sentinel), 'An unused configured filter must remain unexecuted.');
  assert.deepEqual(snapshot(dir), before);
});
