---
name: docraider-crawl
description: Read a URL or collect documentation with Docraider, choosing between one-page reads, site crawls, and explicit URL batches while controlling long-running and large-output work.
license: MIT
compatibility: Requires the Docraider CLI, either on PATH or in the same npm package.
metadata:
  author: docraider
  version: "1.0"
---

# Collect documentation

Run the CLI through `scripts/docraider` in this Skill directory.

1. Choose the smallest operation: `page read` for one page without a broad site crawl, `crawl pages` for an explicit URL set, or `crawl site` to discover and collect a documentation site.
2. Before a site crawl, confirm the requested scope and avoid broad roots when a documentation subtree is sufficient.
3. For a long crawl, request `--format jsonl`, consume events incrementally, and wait for the terminal event. Do not interpret a progress event as completion.
4. For `page read`, bound inline content with `--content-limit` or save long page bodies with `--output <path>`. For crawls, use `--format jsonl` and consume progress incrementally.
5. Do not retry an uncertain long-running operation blindly. Inspect its terminal event/error first, narrow scope, then retry only when safe.
6. Parse JSON/JSONL structurally and honor the exit status.

Read [references/cli.md](references/cli.md) before constructing batches and [references/output.md](references/output.md) for JSONL and output-limit handling.
