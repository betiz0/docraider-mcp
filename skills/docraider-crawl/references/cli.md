# Crawl CLI reference

```text
docraider page read <url> [--content-limit <n>] [--output <path>]
docraider crawl site <url> [--format json|jsonl]
docraider crawl pages --url <url> [--url <url> ...] [--format json|jsonl]
```

Use one `--url` per explicit page. Use `--config <path>` when needed. Prefer the default single JSON response for short operations and JSONL for operations whose progress must be observed. Exact crawl limits come from the selected configuration; use `--help` for version-specific flags.
