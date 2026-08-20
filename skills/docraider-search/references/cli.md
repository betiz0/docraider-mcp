# Search CLI reference

```text
docraider search <query> [--mode keyword|semantic|hybrid] [--limit <n>]
docraider document get <id> [--content-limit <n>] [--output <path>]
docraider document list [--limit <n>] [--offset <n>]
docraider stats
docraider embedding status [--probe]
```

Pass shared `--config <path>` when the intended configuration is not discoverable. Use `--output` rather than placing a large body in the agent context. Search and list responses are previews; retrieve by ID for authoritative content. Run `--help` for the installed version's exact option set.
