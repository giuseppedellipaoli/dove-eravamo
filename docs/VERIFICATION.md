# Verification

Version 0.1.0, 21 October 2026.

- Windows, Node.js 24.19.0: **32 tests passed, 0 failures, 0 skips** using `node --test`.
- The bundled Codex skill validator: **Skill is valid**.
- Synthetic example: `start` reads only the current checkpoint, its explicit active document, applicable root instructions and local Git facts.
- Independent skill trial: correctly identified the fictional reading-list project's unresolved duplicate-link decision, without claiming an implementation or fresh application tests.
- Independent review found two Git issues; both have regression coverage: inherited repository redirects are ignored, and active clean/process filters are not executed. Unused configured filters do not suppress ordinary status.
- Codex CLI 0.163.0-alpha.10.2 recognized the local marketplace and reported plugin 0.1.0 installed and enabled.
- The original private project's helper and tests retain their recorded SHA-256 hashes (see ORIGIN.md).

The GitHub Actions workflow is configured for Windows, Linux and macOS with Node.js 20 and 24. Remote CI and those additional platforms have not been run in this local session.

The plugin reads saved project notes; it cannot certify their accuracy or recover old chats. Reading commands do not run project tests. Only explicit `init` creates a starter checkpoint and refuses to overwrite an existing file.

A fresh Codex chat (or application restart if needed) is required to discover a newly installed skill. Installation and CLI verification do not certify that the current chat has reloaded its skill catalogue.
