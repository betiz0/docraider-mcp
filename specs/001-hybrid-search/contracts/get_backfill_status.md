# Contract: `get_backfill_status`（新規）／ `get_index_stats`（拡張）

バックフィルの進捗・完了状況を参照する。FR-009。

## get_backfill_status — Input Schema

```json
{
  "type": "object",
  "properties": {
    "jobId": { "type": "string", "description": "特定ジョブの状態（任意。未指定は直近ジョブ）" }
  }
}
```

## Output（content[0].text に格納する JSON）

```json
{
  "jobId": "uuid",
  "status": "running",
  "total": 1843,
  "completed": 920,
  "failed": 7,
  "remaining": 916,
  "modelVersion": "text-embedding-3-small",
  "startedAt": "2026-06-13T10:00:00.000Z",
  "finishedAt": null
}
```

- `status`: `running | completed | failed | cancelled`。
- 件数（total/completed/failed）が必ず返る（FR-009, US3 Independent Test）。

## get_index_stats — 拡張

既存の Documents/Chunks/Sites/Queue/LastCrawl に加え、埋め込み状態の集計を追加する:

```
Embeddings: completed=<n> pending=<n> failed=<n>
```

- 集計元: `document_chunks.embedding_status` の GROUP BY。

## 受け入れ基準対応（spec）

- US3 シナリオ1（対象・完了・失敗件数の取得）、US3 Independent Test。
