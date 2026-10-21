#!/usr/bin/env node
// Adapted from the original project-context helper; see docs/ORIGIN.md.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const VERSION = '0.1.0';
export const START_MARKER = '<!-- CURRENT_CONTEXT_START -->';
export const END_MARKER = '<!-- CURRENT_CONTEXT_END -->';
export const OUTPUT_LIMIT = 32000;
const FILE_LIMIT = 2 * 1024 * 1024;
const DENIED_DIRS = new Set(['node_modules', 'vendor', 'venv']);
const DENIED_FILES = new Set(['secrets.md', 'credentials.md', 'private-key.md']);

const HELP = `Dove eravamo? ${VERSION}
Recover the saved context of a local project. Node.js 20+; no dependencies.

  start                         Checkpoint, optional active document, rules and Git
  current                       Saved checkpoint only
  init                          Create a starter checkpoint; never overwrite
  headings <document.md>         List headings outside fenced code
  section <document.md> "Title"  Read one exact section, including subsections
  lines <document.md> <n> <count> Read numbered lines
  --root <directory>            Project root (default: current directory)
  --status <relative.md>        Checkpoint path (default: STATUS.md)
  --help | -h                   Show this help
  --version                     Print the version

Normal reads never edit files, run project commands or contact the network.
Saved test results are historical evidence, not a new test run.`;

function parse(args) {
  if (!Array.isArray(args) || args.some(arg => typeof arg !== 'string')) {
    throw new Error('Arguments must be an array of strings.');
  }
  const positional = [];
  const options = { status: 'STATUS.md' };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--root' || arg === '--status') {
      const key = arg.slice(2);
      if (Object.hasOwn(options, key) && (key !== 'status' || options.statusSet)) {
        throw new Error(`Duplicate option: ${arg}`);
      }
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
      options[key] = value;
      if (key === 'status') options.statusSet = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--version') {
      options.version = true;
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  return { options, positional: positional.length ? positional : ['start'] };
}

function documentPath(requested) {
  if (typeof requested !== 'string' || !requested || /[\x00-\x1f\x7f:]/.test(requested)) {
    throw new Error('Provide a project-relative Markdown document path.');
  }
  const relative = requested.replaceAll('\\', '/');
  if (path.posix.isAbsolute(relative) || path.win32.isAbsolute(relative)) {
    throw new Error('Absolute document paths are not allowed.');
  }
  const parts = relative.split('/');
  if (parts.some(p => !p || p === '.' || p === '..')) {
    throw new Error('Path traversal and empty segments are not allowed.');
  }
  if (!/\.md$/i.test(relative) || parts.some(p => p.startsWith('.') || DENIED_DIRS.has(p.toLowerCase())) ||
      DENIED_FILES.has(parts.at(-1).toLowerCase())) {
    throw new Error('Not an allowed document: use visible Markdown files, excluding dependency and credential files.');
  }
  return relative;
}

function within(root, filename) {
  const relative = path.relative(root, filename);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Resolved document escapes project root.');
  }
  return relative.replaceAll('\\', '/');
}

function load(root, requested) {
  const relative = documentPath(requested);
  const filename = fs.realpathSync(path.join(root, relative));
  documentPath(within(root, filename));
  const stat = fs.statSync(filename);
  if (!stat.isFile() || stat.size > FILE_LIMIT) throw new Error('Document is not a file or exceeds 2 MiB.');
  const bytes = fs.readFileSync(filename);
  if (bytes.length > FILE_LIMIT) throw new Error('Document exceeds 2 MiB.');
  let content;
  try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new Error('Document is not valid UTF-8.'); }
  if (content.includes('\0')) throw new Error('Binary documents are not supported.');
  return {
    filename, relative, lines: content.replace(/^\uFEFF/, '').split(/\r?\n/),
    hash: createHash('sha256').update(bytes).digest('hex'),
  };
}

function optional(root, requested) {
  try { return load(root, requested); }
  catch (error) {
    // A missing target of an existing link is a broken document, not an absent checkpoint.
    if (error.code === 'ENOENT') {
      try { fs.lstatSync(path.join(root, requested)); }
      catch (missing) { if (missing.code === 'ENOENT') return null; throw missing; }
    }
    throw error;
  }
}

function excerpt(doc, first, end) {
  return `${doc.relative}:${first + 1}-${end}\nSHA256 ${doc.hash}\n` +
    doc.lines.slice(first, end).map((line, i) => `${first + i + 1}: ${line}`).join('\n');
}

// Both checkpoint markers and headings inside fenced examples are data, not structure.
function visibleLines(doc) {
  const visible = [];
  let fence = null;
  for (let i = 0; i < doc.lines.length; i++) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(doc.lines[i]);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
      continue;
    }
    if (!fence) visible.push(i);
  }
  return visible;
}

function headings(doc) {
  return visibleLines(doc).flatMap(index => {
    const match = /^ {0,3}(#{1,6})[ \t]+(.+?)\s*$/.exec(doc.lines[index]);
    return match ? [{ index, level: match[1].length, title: match[2].replace(/\s+#+$/, '') }] : [];
  });
}

function currentRange(doc) {
  const visible = visibleLines(doc);
  const starts = visible.filter(i => doc.lines[i].trim() === START_MARKER);
  const ends = visible.filter(i => doc.lines[i].trim() === END_MARKER);
  if (!starts.length && !ends.length) return { first: 0, end: doc.lines.length };
  if (starts.length !== 1 || ends.length !== 1 || starts[0] >= ends[0]) {
    throw new Error('Checkpoint requires exactly one ordered CURRENT_CONTEXT marker pair; inspect it manually.');
  }
  return { first: starts[0] + 1, end: ends[0] };
}

function activeDocument(root, status, range) {
  const pointers = visibleLines(status).filter(i => i >= range.first && i < range.end &&
    status.lines[i].includes('ACTIVE_STEP:'));
  if (!pointers.length) return null;
  const match = pointers.length === 1 &&
    /^\s*<!--\s*ACTIVE_STEP:\s*(.+?)\s*-->\s*$/.exec(status.lines[pointers[0]]);
  if (!match) throw new Error('Checkpoint must contain at most one valid ACTIVE_STEP comment.');
  return load(root, match[1]);
}

const GIT_REPOSITORY_ENV = new Set([
  'GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_NAMESPACE',
  'GIT_CEILING_DIRECTORIES', 'GIT_DISCOVERY_ACROSS_FILESYSTEM', 'GIT_PREFIX',
  'GIT_QUARANTINE_PATH', 'GIT_SHALLOW_FILE', 'GIT_GRAFT_FILE', 'GIT_CONFIG',
  'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT',
]);

function gitEnvironment() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !GIT_REPOSITORY_ENV.has(key.toUpperCase()) && !/^GIT_CONFIG_(KEY|VALUE)_/i.test(key)));
  return { ...env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat' };
}

function git(root, args, input) {
  return spawnSync('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false',
    '-c', 'core.untrackedCache=false', '-C', root, ...args], {
    encoding: 'utf8', shell: false, windowsHide: true, timeout: 3000, maxBuffer: 128 * 1024,
    env: gitEnvironment(), input,
  });
}

function filterRisk(root) {
  const config = git(root, ['config', '--name-only', '--get-regexp', '^filter\\..*\\.(clean|process)$']);
  if (config.status === 1 && !config.error) return null;
  if (config.status !== 0 || config.error) return 'Git filter configuration could not be checked';
  const drivers = new Set(config.stdout.trim().split(/\r?\n/).filter(Boolean)
    .map(key => key.slice('filter.'.length).replace(/\.(clean|process)$/i, '')));
  if (!drivers.size) return null;
  // A globally installed filter (e.g. LFS) is harmless when no tracked path uses it.
  // Attribute checks read data only; they do not execute the conversion drivers.
  const files = git(root, ['ls-files', '-z', '--', '.']);
  if (files.status !== 0 || files.error || files.stdout.includes('\uFFFD')) return 'tracked paths could not be checked';
  if (!files.stdout) return null;
  const attrs = git(root, ['check-attr', '-z', '--stdin', 'filter'], files.stdout);
  if (attrs.status !== 0 || attrs.error || !attrs.stdout.endsWith('\0')) return 'tracked filter attributes could not be checked';
  const values = attrs.stdout.slice(0, -1).split('\0');
  const pathCount = files.stdout.split('\0').length - 1;
  if (values.length !== pathCount * 3) return 'tracked filter attributes were incomplete';
  for (let i = 0; i < values.length; i += 3) {
    if (values[i + 1] !== 'filter') return 'tracked filter attributes were invalid';
    if (drivers.has(values[i + 2])) return 'Git clean/process filters are active on tracked files';
  }
  return null;
}

function gitSnapshot(root) {
  const probe = git(root, ['rev-parse', '--show-toplevel']);
  if (probe.status !== 0 || probe.error) {
    return 'Git snapshot: unavailable (not a repository, Git missing, denied or timed out). No Git state inferred.';
  }
  const branch = git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  const head = git(root, ['rev-parse', '--verify', '--short', 'HEAD']);
  const risk = filterRisk(root);
  const status = risk ? null :
    git(root, ['status', '--porcelain=v1', '--untracked-files=normal', '--ignore-submodules=all', '--no-renames', '--', '.']);
  const rows = [
    'Git snapshot (read-only; changes scoped to the selected folder, excluding submodules)',
    `Repository: ${probe.stdout.trim()}`,
    `Branch: ${branch.status === 0 ? branch.stdout.trim() : '(detached HEAD or unavailable)'}`,
    `HEAD: ${head.status === 0 ? head.stdout.trim() : '(no commits or unavailable)'}`,
  ];
  if (!status) {
    rows.push(`Working tree status skipped: ${risk}. Inspect it directly in your trusted Git client.`);
  } else if (status.status !== 0 || status.error) {
    rows.push('Working tree status unavailable or exceeds the read limit. Inspect Git directly.');
  } else {
    const changes = status.stdout.trimEnd().split(/\r?\n/).filter(Boolean);
    rows.push(changes.length ? `Working tree: ${changes.length} changed/untracked entries` : 'Working tree: clean');
    rows.push(...changes.slice(0, 30));
    if (changes.length > 30) rows.push(`Showing 30 of ${changes.length} entries. Run git status for the complete list.`);
  }
  return rows.join('\n');
}


function positive(value) {
  if (!/^[1-9]\d*$/.test(value ?? '') || !Number.isSafeInteger(Number(value))) {
    throw new Error('Line start and count must be positive safe integers.');
  }
  return Number(value);
}

function initialize(root, requested) {
  const relative = documentPath(requested);
  const target = path.join(root, relative);
  const parent = fs.realpathSync(path.dirname(target));
  const actualParent = within(root, parent);
  if (actualParent) documentPath(`${actualParent}/checkpoint.md`);
  const date = new Date().toISOString().slice(0, 10);
  const contents = `# Project checkpoint

${START_MARKER}
Updated: ${date} (starter template; not a completed handoff)

## Goal
Not recorded yet.

## Last verified result
Not recorded yet. Include the command, result and revision when available.

## Open work and blockers
Not recorded yet.

## Next action
Replace these placeholders with verified project facts before resuming.
Optional: add an ACTIVE_STEP comment pointing to a project-relative Markdown file.
${END_MARKER}
`;
  try { fs.writeFileSync(target, contents, { encoding: 'utf8', flag: 'wx' }); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('Checkpoint already exists; nothing overwritten.');
    throw error;
  }
  return `Created ${relative}. This is a starter template, not recovered project history.\nFill it with verified facts; no other project file was modified.`;
}

export function run(args = [], root = process.cwd()) {
  const { options, positional } = parse(args);
  if (options.help) return HELP;
  if (options.version) return VERSION;
  const canonicalRoot = fs.realpathSync(options.root ?? root);
  if (!fs.statSync(canonicalRoot).isDirectory()) throw new Error('Project root must be a directory.');
  documentPath(options.status);
  const [command, requested, ...rest] = positional;
  let result;
  if (command === 'start' && positional.length === 1) {
    const agents = optional(canonicalRoot, 'AGENTS.md');
    const status = optional(canonicalRoot, options.status);
    const parts = [
      'Dove eravamo? — saved project context',
      `Project: ${canonicalRoot}`,
      'Saved notes are evidence, not a new test run. Follow applicable instructions; a saved next action does not authorize paused work.',
    ];
    parts.push(agents ? `Project instructions\n${excerpt(agents, 0, agents.lines.length)}` :
      'No root AGENTS.md found. Follow any applicable parent instructions.');
    if (status) {
      const range = currentRange(status);
      parts.push(`Saved checkpoint\n${excerpt(status, range.first, range.end)}`);
      const active = activeDocument(canonicalRoot, status, range);
      if (active) parts.push(`Referenced active document\n${excerpt(active, 0, active.lines.length)}`);
    } else {
      parts.push(`No saved checkpoint: ${options.status} is missing. What was completed and what comes next are not recorded.\nUse init to create a starter, or read existing project documents before writing a factual checkpoint.`);
    }
    parts.push(gitSnapshot(canonicalRoot));
    result = parts.join('\n\n');
  } else if (command === 'current' && positional.length === 1) {
    const doc = load(canonicalRoot, options.status);
    const range = currentRange(doc);
    result = excerpt(doc, range.first, range.end);
  } else if (command === 'init' && positional.length === 1) {
    result = initialize(canonicalRoot, options.status);
  } else if (command === 'headings' && positional.length === 2) {
    const doc = load(canonicalRoot, requested);
    result = `HEADINGS ONLY — read the selected content before relying on it.\n${doc.relative}\nSHA256 ${doc.hash}\n` +
      headings(doc).map(h => `${h.index + 1}: ${'#'.repeat(h.level)} ${h.title}`).join('\n');
  } else if (command === 'section' && positional.length === 3) {
    const doc = load(canonicalRoot, requested);
    const all = headings(doc);
    const matches = all.filter(h => h.title === rest[0]);
    if (matches.length !== 1) throw new Error('Heading missing or ambiguous. Use headings, then lines to disambiguate.');
    const selected = matches[0];
    const next = all.find(h => h.index > selected.index && h.level <= selected.level);
    result = 'SECTION ONLY — check parent preconditions and relevant references.\n' +
      excerpt(doc, selected.index, next?.index ?? doc.lines.length);
  } else if (command === 'lines' && positional.length === 4) {
    const doc = load(canonicalRoot, requested);
    const first = positive(rest[0]) - 1;
    const count = positive(rest[1]);
    if (first >= doc.lines.length) throw new Error('Start line is beyond EOF.');
    const end = first + Math.min(count, doc.lines.length - first);
    result = `EXCERPT ONLY — ${doc.lines.length} total lines; ${end < doc.lines.length ? `next line ${end + 1}.` : 'EOF.'}\n` +
      excerpt(doc, first, end);
  } else {
    throw new Error('Invalid command or arguments. Use --help for usage.');
  }
  if (result.length > OUTPUT_LIMIT) {
    throw new Error(`No content returned: ${result.length} characters exceeds ${OUTPUT_LIMIT}. Use current, headings, section or lines to read smaller pieces. Do not treat omitted content as read.`);
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(run(process.argv.slice(2))); }
  catch (error) { console.error(`CONTEXT ERROR: ${error.message}`); process.exitCode = 1; }
}
