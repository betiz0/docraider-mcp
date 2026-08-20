# Management CLI reference

```text
docraider stats
docraider site list
docraider site get <id>
docraider site delete <id> --confirm <id>
docraider embedding status [--job-id <id>] [--probe]
docraider embedding backfill
```

The delete command's positional ID and confirmation ID must be identical, but CLI validation is not a replacement for explicit user approval. `--probe` can contact external services and should not be used in routine polling. Parse the standard JSON envelope and honor exit codes.
