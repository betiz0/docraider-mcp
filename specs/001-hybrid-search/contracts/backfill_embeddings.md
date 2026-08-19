# Contract: `backfill_embeddings`（新規）

既存クロール済みドキュメントを意味検索対象に変換する非同期バックフィルを開始する。FR-008/010/016。

## Input Schema

```json
{
  "type": "object",
  "properties": {
    "siteId": { "type": "string", "description": "対象サイトに限定（任意。未指定は全体）" },
    "retryFailed": { "type": "boolean", "default": true, "description": "failed断片を再試行対象に含める" }
  }
}
```

## 振る舞い契約

| 条件 | 期待結果 |
|---|---|
| 呼び出し | 即座に受付応答（`jobId` と対象件数見込み `estimatedTotal`）を返し、処理はバックグラウンド継続（FR-008） |
| 対象抽出 | `embedding_status IN ('pending','failed')`（`retryFailed=false` 時は `pending` のみ）。`completed` は除外（FR-010 冪等） |
| 既に `running` のジョブがある | 新規開始せず既存 `jobId` を返す（直列化） |
| 2 回連続実行 | 2 回目に再処理される断片は 0 件（SC-007） |
| 埋め込みエンドポイント接続不可 | ジョブは `running`→個別断片 `failed` を計上、致命時はジョブ `failed`。キーワード検索には影響しない（FR-011） |

## Output（content[0].text に格納する JSON）

```json
{
  "accepted": true,
  "jobId": "uuid",
  "estimatedTotal": 1843,
  "status": "running"
}
```

## 受け入れ基準対応（spec）

- US3 シナリオ1（受付応答・見込み件数）、シナリオ3（再実行で未処理分のみ）。
