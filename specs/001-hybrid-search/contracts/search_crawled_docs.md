# Contract: `search_crawled_docs`（改修）

MCP ツール。既存ツールを拡張し、検索方式選択・ヒット方式・スコアを追加する。FR-001/002/003/004/005/006/017/018。

## Input Schema

```json
{
  "type": "object",
  "properties": {
    "query":   { "type": "string", "description": "検索クエリ（必須・非空）" },
    "mode":    { "type": "string", "enum": ["keyword", "semantic", "hybrid"], "default": "hybrid", "description": "検索方式。未指定はhybrid" },
    "limit":   { "type": "number", "default": 20, "description": "最大結果件数。1..100にクランプ" },
    "offset":  { "type": "number", "default": 0, "description": "ページネーションオフセット。非負にクランプ" },
    "siteId":  { "type": "string", "description": "サイトIDで絞り込み（任意）" }
  },
  "required": ["query"]
}
```

## 振る舞い契約

| 条件 | 期待結果 |
|---|---|
| `mode` 未指定 | `hybrid` で実行（FR-002, SC-008） |
| `mode` が enum 外（例 `"fuzzy"`） | 明確なエラーを返す。既定に黙って切替えない（FR-006） |
| `query` が空文字/空白のみ | 明確なエラー（無言クラッシュしない） |
| `limit` が 0/負数/100超過 | 1..100 にクランプ（FR-017） |
| `offset` が負数 | 0 にクランプ |
| データ 0 件 | 空結果＋件数 0、エラーにしない |
| `mode=semantic` で埋め込みが皆無 | 空結果＋件数 0（エラーにしない、FR-012） |
| `mode=hybrid` で意味検索が失敗/未準備 | keyword 結果にフォールバックして返す（FR-012, SC-005） |
| `siteId` 指定 | 全方式で当該サイトのみ返す（FR-018） |

## Output（content[0].text に格納する JSON）

```json
{
  "mode": "hybrid",
  "total": 12,
  "results": [
    {
      "chunkId": "uuid",
      "documentId": "uuid",
      "url": "https://example.com/docs/auth",
      "title": "Authentication",
      "headline": "... <b>authentication</b> ...",
      "matchType": "both",
      "score": 0.0326,
      "keywordRank": 1,
      "semanticRank": 2
    }
  ]
}
```

- 各 `results[*]` は `matchType`（`keyword|semantic|both`）と数値 `score` を必ず含む（FR-004, SC-006）。
- 同一 `chunkId` は 1 件に統合され、両方式ヒットは `matchType="both"`（FR-005）。

## 受け入れ基準対応（spec）

- US2 シナリオ1〜4、US1 シナリオ3、US4 シナリオ1〜3。
