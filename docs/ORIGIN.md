# Origin

Dove eravamo? grew out of a context helper used to resume work on a private game project. The original workflow kept the current state in Markdown, then read only the sections needed for the next step.

This package generalizes that idea into a small Node.js helper and a Codex skill. It removes the original project's paths, names, documents, assets, and domain-specific assumptions. The example project is fictional. It needs no access to the original repository.

The helper combines an explicit checkpoint with local Git facts. It does not recover chat history or infer an unfinished task from commit messages. The checkpoint remains the author's record of intent; Git provides evidence about the current working tree.

For provenance, the source files reviewed during extraction had these SHA-256 hashes:

- Original helper: `34452D0FA4F7E53F65FEC21715F6D3C2A4BD2090F5CD14278F921A5C046E4235`
- Original tests: `7E227995B457A2FED5DF7DE0B62CF4F840331F89645F3E2881C9346DEB56CC45`

The new package is released under the MIT license. See [LICENSE](../LICENSE).
