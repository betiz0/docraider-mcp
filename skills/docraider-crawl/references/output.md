# Crawl output and duration

Default output is one success or failure JSON envelope. With `--format jsonl`, every nonempty stdout line is a standalone JSON event containing an event kind, timestamp, and operation identifier; the final line is a terminal success or failure event.

- Consume lines incrementally and retain the operation ID.
- Only the terminal event establishes completion.
- Keep stderr separate from the JSONL parser.
- On interruption or missing terminal event, report an indeterminate outcome rather than immediately duplicating the crawl.
- For `page read`, use `--content-limit` for bounded inline content or `--output` for large bodies. Crawl commands do not save result streams with these flags; use JSONL and retain only the terminal event plus needed progress records.
