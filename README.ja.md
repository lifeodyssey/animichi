<div align="center">

# 聖地巡礼 Animichi

**アニメ聖地の検索・ルート計画を支援する AI エージェント**

[![CI](https://github.com/lifeodyssey/animichi/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/lifeodyssey/animichi/actions/workflows/ci.yml?query=branch%3Amain)
[![Python 3.11+](https://img.shields.io/badge/python-3.11+-3776ab.svg)](https://www.python.org)
[![TanStack Start](https://img.shields.io/badge/TanStack_Start-SSR-FF4154.svg)](https://tanstack.com/start)
[![Cloudflare Workers](https://img.shields.io/badge/deploy-Cloudflare_Workers-f38020.svg?logo=cloudflare)](https://developers.cloudflare.com/workers/)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres-3ecf8e.svg?logo=supabase)](https://supabase.com)
[![GitHub last commit](https://img.shields.io/github/last-commit/lifeodyssey/animichi)](https://github.com/lifeodyssey/animichi/commits/main)
[![GitHub stars](https://img.shields.io/github/stars/lifeodyssey/animichi?style=flat)](https://github.com/lifeodyssey/animichi)

[**ライブデモ**](https://seichijunrei.zhenjia.org) | [アーキテクチャ](docs/ARCHITECTURE.md) | [デプロイ](docs/ops/deployment.md)

[English](README.md) | [日本語](README.ja.md) | [中文](README.zh.md)

</div>

---

アニメのタイトルや場所を自然言語で伝えるだけで、実在する聖地巡礼スポットを検索し、地図上に表示し、巡回ルートを計画します。すべて一回の会話で完結します。

## 仕組み

```
ユーザー入力 → PydanticAI Agent（animichi_agent）
                 ├── resolve_anime  → catalog Worker のタイトル解決; ミス時は Bangumi 取り込み
                 ├── search_bangumi → 解決済み bangumi_id の catalog ポイント
                 ├── search_nearby  → catalog 地理検索（Neon 上の PostGIS）
                 ├── plan_route     → catalog ルート並び替え
                 └── web_search / translate → 出典付き調査 / タイトル翻訳
              → AgentResult（型付き出力 + ツール呼び出し記録）
```

単一の PydanticAI エージェントがプランニングとツール実行を担当します。ツールは `ModelRetry` ガードで無効なパラメータを拒否し、`output_validator` が捏造された応答を検出します。選択済みポイントのルートはエージェントを経由しません。

`resolve_anime` は自己進化型です。未知のタイトルを初めてクエリすると、Bangumi.tv からメタデータを取得してDBに保存し、以降のクエリはローカルDBから応答します。

## 主な機能

- **会話型検索** — 日本語・英語・中国語で質問可能、エージェントが意図を判定
- **自己進化するアニメカタログ** — DB優先、Bangumi.tv API によるライトスルー
- **地理検索** — 座標や駅名から近隣の聖地を検索
- **ルート計画** — 最近傍法による巡回順序の最適化
- **ジェネレーティブ UI** — 3カラムレイアウト（チャット + 結果パネル）
- **エッジ認証** — JWT（マジックリンク）と API キー認証を Cloudflare Worker で実施
- **評価ハーネス** — 3言語 × 50件以上のプラン品質テストケース

## クイックスタート

```bash
# Python 依存関係のインストール
uv sync --extra dev

# ローカルでサービスを起動
make serve

# テストの実行
make test              # ユニットテスト
make test-integration  # 安定版統合テスト
make test-all          # ユニット + 統合
make test-eval         # モデル依存の評価テスト（LLMアクセスが必要）
make check             # lint + 型チェック + テスト
```

## データベースマイグレーション

Neon の catalog/user データ面のスキーマ変更は `db/migrations/` に記録し、固定した
Atlas CLI で適用します。`db/migrations/atlas.sum` は生成される整合性マニフェストなので、
マイグレーションと同じ変更で再生成してください。Worker の Drizzle schema は実行時の
クエリ/型情報だけを提供し、マイグレーションを生成・適用しません。残る Supabase の
マイグレーションは auth/旧版互換用で、Neon の新しいテーブルのソースではありません。

```bash
make db-list           # リポジトリ内の Atlas マイグレーション一覧
make db-hash           # db/migrations/atlas.sum を再生成
make db-validate       # checksum と SQL 構造を検証
make db-push-dry       # NEON_DATABASE_URL に対する dry-run
make db-push           # NEON_DATABASE_URL に適用
```

境界、CI ゲート、デプロイ順序は [`docs/ops/migrations.md`](docs/ops/migrations.md) を参照してください。マイグレーションはアプリ起動時ではなく、デプロイ時の専用ステップで適用してください。

## 環境変数

**必須（agent コンテナ / ローカル serve）：**
| 変数名 | 用途 |
|---|---|
| `SUPABASE_DB_URL` | agent ドメインの Postgres 接続文字列 |
| `SUPABASE_URL` | Supabase プロジェクト URL（auth + API キー照会） |
| `SUPABASE_SERVICE_ROLE_KEY` | サーバーサイド Supabase 認証 / `api_keys` 照会 |
| `MIMO_API_KEY` | 主モデルプロバイダキー |
| `DEEPSEEK_API_KEY` | エッジ container-env がコンテナ起動時に要求（コンテナへ転送） |

**Worker エッジ:** `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`（JWT は公開 JWKS で検証 — エッジに `SUPABASE_ANON_KEY` は不要）。catalog/users/maintenance は各 Neon DSN も必要 — [`docs/ops/deployment.md`](docs/ops/deployment.md)。

**オプション：** `SERVICE_HOST`, `SERVICE_PORT`, `OBSERVABILITY_*`, `DEFAULT_AGENT_MODEL`

詳細は [`apps/agent/src/animichi/config/settings.py`](apps/agent/src/animichi/config/settings.py) と [`.env.example`](.env.example) を参照してください。

## 使用例

**Python（直接呼び出し）：**
```python
from animichi.agents.animichi_runner import run_animichi_agent
from animichi.infrastructure.supabase.client import SupabaseClient

async def main() -> None:
    async with SupabaseClient(db_url) as db:
        result = await run_animichi_agent("吹響ユーフォニアムの聖地", db, locale="ja")
        print(result.output)
```

**HTTP（API キー）：**
```bash
curl -X POST https://seichijunrei.zhenjia.org/v1/runtime \
  -H 'Authorization: Bearer sk_your_key_here' \
  -H 'Content-Type: application/json' \
  -d '{"text":"吹響の聖地","locale":"ja"}'
```

## リポジトリ構成マップ

- `apps/agent/` — Python ランタイム本体。agents、interfaces、infrastructure、tests、tools を含む
- `workers/catalog/` — アニメカタログ API + データ基盤の Cloudflare Worker（TypeScript）
- `workers/users/` — ユーザー領域データ Worker（`/v1/users/*`）
- `workers/maintenance/` — スケジュール Neon 保持 Worker（公開ルートなし）
- `packages/contract/` — 共有 oRPC/zod 契約（catalog ↔ agent ↔ users）
- `apps/web/` — TanStack Start SSR Web アプリ（**唯一のブラウザ面**）
- `workers/edge/` — 認証と `/v1` ルーティングの Cloudflare Worker 入口
- `db/migrations/` — Neon データ面の Atlas マイグレーションと生成 checksum
- `supabase/` — auth/旧版互換マイグレーションと Supabase プロジェクト資産
- `docs/` — アーキテクチャ、運用手順、イテレーション資料、実装計画
- `Dockerfile`、`Makefile`、`wrangler.toml`、`package.json` — ルートに残すランタイム/ツール入口

## ドキュメント

- [アーキテクチャ](docs/ARCHITECTURE.md) — システム設計リファレンス
- [デプロイ](docs/ops/deployment.md) — Cloudflare Workers + Containers デプロイガイド
- [マイグレーション境界](docs/ops/migrations.md) — Atlas authority と Drizzle のクエリ/型境界
- [運用ドキュメント](docs/ops/README.md) — 運用手順と環境向けランブック
- [イテレーション資料](docs/iterations/README.md) — task plan、progress、findings の保存場所
- [実装計画（アーカイブ）](docs/superpowers/plans/archive/) — 過去の実行計画（平層 `plans/` には新規を置かない）
- [設計仕様](docs/superpowers/specs/) — 現行のプロダクト/アーキテクチャ仕様
- [エージェントガイド](AGENTS.md) — monorepo 構成・コマンド・横断ガードレール
