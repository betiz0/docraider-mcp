---
name: docraider-manage
description: Inspect Docraider sites and embedding readiness, safely manage backfill jobs, and delete a site only after explicit user approval and ID-matched confirmation.
license: MIT
compatibility: Requires the Docraider CLI, either on PATH or in the same npm package.
metadata:
  author: docraider
  version: "1.0"
---

# Manage sites and embedding readiness

Run commands through `scripts/docraider` in this Skill directory.

## Readiness and backfill

1. Run `embedding status` first. Add `--probe` only when a current external endpoint/schema check is necessary.
2. Follow `recommendedAction`. If semantic search is unavailable, fall back to keyword search; hybrid may remain usable in degraded mode.
3. Before `embedding backfill`, inspect the latest job and worker state. If a job is queued/running or the action says to wait/restart, do not create another request.
4. After starting once, retain the returned job ID and poll `embedding status --job-id <id>` at a reasonable interval. Never loop on `backfill` itself.
5. Retry a failed job only when status explicitly recommends retry and the failure cause has been addressed.

## Destructive deletion

Delete only when the user explicitly asked to delete that site. First run `site get <id>`, show/verify the target, and require final approval for that exact ID. Then and only then run `site delete <id> --confirm <id>`. Never infer confirmation, substitute an ID, or bypass a mismatch.

Read [references/cli.md](references/cli.md) and [references/readiness.md](references/readiness.md) for detailed interpretation.
