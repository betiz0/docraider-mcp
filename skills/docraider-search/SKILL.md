---
name: docraider-search
description: Search Docraider's saved documentation, inspect bounded results, and retrieve only the documents or pages needed for research. Use for questions about already-crawled content.
license: MIT
compatibility: Requires the Docraider CLI, either on PATH or in the same npm package.
metadata:
  author: docraider
  version: "1.0"
---

# Search saved documentation

Use `scripts/docraider` from this Skill directory. It selects an installed CLI safely; do not invoke an assumed global path directly.

1. Start with `scripts/docraider search <query>`. Prefer a narrow query and inspect bounded previews.
2. Refine the query or filters before fetching full content.
3. Use `scripts/docraider document get <id>` only for relevant result IDs. Use `--content-limit <n>` for conversational output or `--output <path>` for long content.
4. Use `document list` only to browse the corpus; do not treat it as a full-content dump.
5. If semantic or hybrid search is unavailable, use keyword mode. Consult the management Skill for readiness; do not repeatedly start backfill from this Skill.
6. Parse stdout as the documented JSON envelope. Treat nonzero exit status or `ok: false` as failure, and report the error without guessing.

Read [references/cli.md](references/cli.md) for commands/options and [references/output.md](references/output.md) when interpreting envelopes, warnings, or saved-output metadata.
