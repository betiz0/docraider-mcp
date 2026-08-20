# CLI output contract

Except for explicitly requested JSONL crawl progress, stdout is one JSON value.

- Success: `{"ok":true,"command":"...","data":...,"warnings":[]}`
- Failure: `{"ok":false,"command":"...","error":{"code":"...","message":"...","details":...}}`

Diagnostics belong on stderr. Exit codes are `0` success, `1` unexpected, `2` invalid input, `3` not found, `4` configuration, `5` database, and `6` external service.

When `--output` is used, expect metadata such as an absolute path, bytes written, content type, and truncation state instead of an unbounded body. Preserve warnings and distinguish a truncated preview from the complete saved document.
