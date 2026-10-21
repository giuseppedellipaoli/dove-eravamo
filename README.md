# Dove eravamo?

**Pick up an unfinished project without rereading everything.**

A small Codex plugin that turns a Markdown checkpoint and local Git facts into a useful starting point: where you left off, what changed, what is blocked, and the next concrete action.

[Italiano](README.it.md) · [MIT license](LICENSE)

```text
$dove-eravamo pick up this project and show me the next step.
```

It reads the checkpoint you maintain. It does not recover old chats or guess your intentions from commit messages. With no checkpoint, it reports the available Git facts and the missing context.

## Try it in 30 seconds

Requires **Node.js 20 or newer**. Git is optional. There are no npm dependencies to install.

From this repository's root:

```sh
node skills/dove-eravamo/scripts/project-context.mjs start --root examples/tiny-project
```

The fictional example records a reading-list app with no implementation yet. The useful next step is to decide how duplicate links should behave, then write an acceptance example. See the [checkpoint](examples/tiny-project/STATUS.md) and [active task](examples/tiny-project/docs/next-step.md).

## Install in Codex

Install directly from GitHub with a recent Codex CLI:

~~~sh
codex plugin marketplace add giuseppedellipaoli/dove-eravamo --ref main
codex plugin add dove-eravamo@dove-eravamo-local
~~~

If you already cloned this repository, register the local copy instead:

```sh
codex plugin marketplace add .
codex plugin add dove-eravamo@dove-eravamo-local
```

Restart the desktop app and start a new chat. After registration, you can also find the plugin in the local marketplace in the Plugins Directory. The included `.agents/plugins/marketplace.json` points to this repository's root. Client support can vary; see the [official plugin guide](https://developers.openai.com/plugins/build/plugins).

**Standalone skill:** copy the entire `skills/dove-eravamo` folder into `~/.agents/skills/dove-eravamo` for your user, or `<your-project>/.agents/skills/dove-eravamo` for one project. Restart Codex if it does not appear. Use one installation route. See [Codex skill locations](https://learn.chatgpt.com/docs/build-skills#where-codex-loads-local-skills).

Then open the project you want to resume and ask:

```text
$dove-eravamo where did we leave off? Read the checkpoint and check the working tree.
```

The plugin needs local file and command access. This repository being on GitHub does not itself install the plugin or publish it to the public Plugins Directory.

## Give your project a checkpoint

Keep a short `STATUS.md` at the project root. Record the goal, last completed work, current task, blockers or open decisions, and next action. Update it when you stop work so the next session has a reliable handoff.

To create a starter, run this from the plugin repository, replacing the example path:

```sh
node skills/dove-eravamo/scripts/project-context.mjs init --root /path/to/your-project
```

`init` creates only the checkpoint file (`STATUS.md` by default), and refuses to overwrite an existing file. With `--status`, its parent folder must already exist. It does not fill in project facts for you.

A plain Markdown checkpoint works. For a longer status file, isolate the current context with these markers:

```md
<!-- CURRENT_CONTEXT_START -->
## Last completed
Describe the last verified result.

## Next action
Write the first concrete action.

<!-- ACTIVE_STEP: docs/next-step.md -->
<!-- CURRENT_CONTEXT_END -->
```

`ACTIVE_STEP` is optional and points to a Markdown document relative to the project root. Without the context markers, the helper reads the whole checkpoint. To use another checkpoint location, add `--status notes/STATUS.md`.

## CLI reference

These examples run from the plugin repository:

```sh
node skills/dove-eravamo/scripts/project-context.mjs start --root /path/to/project
node skills/dove-eravamo/scripts/project-context.mjs current --root /path/to/project
node skills/dove-eravamo/scripts/project-context.mjs headings docs/next-step.md --root /path/to/project
node skills/dove-eravamo/scripts/project-context.mjs section docs/next-step.md "Acceptance criteria" --root /path/to/project
node skills/dove-eravamo/scripts/project-context.mjs lines STATUS.md 1 20 --root /path/to/project
```

| Command | Result |
| --- | --- |
| `start` | Root `AGENTS.md` if present, checkpoint, optional active-task document, and a local Git summary. |
| `current` | Only the current checkpoint content. |
| `headings <file.md>` | Markdown headings for choosing a section. |
| `section <file.md> <heading>` | One heading and its section. |
| `lines <file.md> <first> <count>` | A numbered excerpt; line numbers start at 1. |
| `init` | A starter checkpoint if none exists (`STATUS.md` by default). |

`--root` defaults to the current directory. `--status` defaults to `STATUS.md`. Document paths stay inside the selected project; files are limited to 2 MiB. Oversized output fails explicitly instead of silently cutting off context. Use focused document commands for smaller excerpts.

## Local data and limits

The helper makes no network requests and collects no telemetry. Its Git summary reads the local branch, HEAD, and tracked/untracked file status; it does not fetch, push, read remote URLs, or scan commit messages. The working-tree summary excludes submodules and lists up to 30 entries, explicitly reporting any additional entries. It is skipped if clean/process filters apply to tracked files or the read-only filter check fails; these filters are never executed. The reading commands leave project files unchanged. Only `init` writes a file.

Selected text becomes part of the Codex context when the skill is used. Keep credentials out of checkpoints. A checkpoint can become stale: the skill should call out differences between recorded plans and the current working tree. Projects without Git still work; projects without a checkpoint have less context.

## Development

Run the built-in Node.js test suite:

```sh
node --test
```

No build step or package installation is required. The CI matrix targets Windows, macOS, and Linux on Node.js 20 and 24. Small improvements with a reproducible example are welcome. See [the project's origin](docs/ORIGIN.md) for the extraction from a private game-development helper.
