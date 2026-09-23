<div align="center">

# 聖地巡礼 Animichi

**アニメ聖地の検索・ルート計画を支援する AI エージェント**

[![CI](https://github.com/lifeodyssey/animichi/actions/workflows/pr-verification.yml/badge.svg?branch=main)](https://github.com/lifeodyssey/animichi/actions/workflows/pr-verification.yml?query=branch%3Amain)
[![TanStack Start](https://img.shields.io/badge/TanStack_Start-SSR-FF4154.svg)](https://tanstack.com/start)
[![Cloudflare Workers](https://img.shields.io/badge/deploy-Cloudflare_Workers-f38020.svg?logo=cloudflare)](https://developers.cloudflare.com/workers/)
[![Neon](https://img.shields.io/badge/Neon-Postgres-30cf9e.svg?logo=neon)](https://neon.tech)
[![GitHub last commit](https://img.shields.io/github/last-commit/lifeodyssey/animichi)](https://github.com/lifeodyssey/animichi/commits/main)
[![GitHub stars](https://img.shields.io/github/stars/lifeodyssey/animichi?style=flat)](https://github.com/lifeodyssey/animichi)

[**ライブデモ**](https://seichijunrei.zhenjia.org) | [アーキテクチャ](docs/ARCHITECTURE.md) | [デプロイ](docs/ops/deployment.md)

[English](README.md) | [日本語](README.ja.md) | [中文](README.zh.md)

</div>

---

アニメのタイトルや場所を自然言語で伝えるだけで、実在する聖地巡礼スポットを検索し、地図上に表示し、巡回ルートを計画します。すべて一回の会話で完結します。

## 仕組み

```
ユーザー入力 → ネイティブ Pi エージェント（workers/edge/src/agent/）
                 ├── resolve_anime  → catalog Worker のタイトル解決; ミス時は Bangumi 取り込み
                 ├── search_bangumi → 解決済み bangumi_id の catalog ポイント
                 ├── search_nearby  → catalog 地理検索（Neon 上の PostGIS）
                 ├── plan_route     → catalog ルート並び替え
                 └── web_search / translate → 出典付き調査 / タイトル翻訳
              → 回答 + ツール呼び出し記録
```

単一のエージェントがプランニングとツール実行を担当します。選択済みポイントのルートはエージェントを経由しません。

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
# 依存関係のインストール
pnpm install

# ローカルで Web アプリを起動
make dev-local

# 全パッケージの lint・型チェック・テスト
make check-full
```

## データベースマイグレーション

Neon データ面のスキーマは `packages/pi-session-neon/src/contract.prisma` で宣言し、
`packages/pi-session-neon/migrations/` の 1 本の Prisma 8 チェーンとして版管理します。生成物は
マイグレーションと同じ変更で再生成してください。Worker は独自のスキーマを持ちません。
このチェーンが生成する contract がこのデータ面の唯一の地図です（#1633）。`supabase/` は
アーカイブ対象の歴史的 Supabase マイグレーションツリー（issue #1000）で、適用されず
Neon の新しいテーブルのソースでもありません。

```bash
make db-new NAME=x     # チェーンにマイグレーションを起草
make db-lint           # 生成物の整合性とグラフの連結性
make db-status         # 適用パスと未適用の一覧
```

ローカルに apply ターゲットはありません。データベース資格情報を持つのは migrator Worker
だけで、マイグレーションを適用するのは CD だけです。

境界、CI ゲート、デプロイ順序は [`docs/ops/migrations.md`](docs/ops/migrations.md) を参照してください。マイグレーションはアプリ起動時ではなく、デプロイ時の専用ステップで適用してください。

## 環境変数

**必須（agent コンテナ / ローカル serve）：**
| 変数名 | 用途 |
|---|---|
| `AGENT_SVC_DATABASE_URL` | Neon agent_svc ロール DSN（asyncpg)——agent コンテナが必要とするデータ面接続（#912）。旧称 `SUPABASE_DB_URL` は #855 プロダクション切替まで暫定の容器-DSN 名として残る |
| `MIMO_API_KEY` | 主モデルプロバイダキー |

**Worker エッジ:** `NEON_AUTH_JWKS_URL`（エッジの**唯一の** identity ソース — AUTH-2 #950。Neon Auth の EdDSA JWT をブランチ JWKS で検証。本番はブランチ準備まで未設定＝ fail-closed）。catalog/users/jobs は各 Neon DSN も必要 — [`docs/ops/deployment.md`](docs/ops/deployment.md)。

**Web（`apps/web`）:** `VITE_NEON_AUTH_BASE_URL`（Better Auth クライアントのログイン元 + JWT 交換）— [`apps/web/.env.example`](apps/web/.env.example)。

**オプション：** `SERVICE_HOST`, `SERVICE_PORT`, `OBSERVABILITY_*`, `DEFAULT_AGENT_MODEL`

既定値は [`.env.example`](.env.example) を参照してください。

## 使用例

**HTTP（認証済み）：**
```bash
curl -N -X POST https://seichijunrei.zhenjia.org/v1/chat \
  -H 'Authorization: Bearer <neon_auth_jwt>' \
  -H 'Content-Type: application/json' \
  -H 'x-locale: ja' \
  -d '{"messages":[{"role":"user","parts":[{"type":"text","text":"吹響の聖地"}]}]}'
```

## リポジトリ構成マップ

- `workers/catalog/` — アニメカタログ API + データ基盤の Cloudflare Worker（TypeScript）
- `workers/users/` — ユーザー領域データ Worker（`/v1/users/*`）
- `packages/contract/` — 共有 oRPC/zod 契約（catalog ↔ agent ↔ users）
- `apps/web/` — TanStack Start SSR Web アプリ（**唯一のブラウザ面**）
- `workers/edge/` — 認証と `/v1` ルーティングの Cloudflare Worker 入口
- `supabase/` — 旧版互換マイグレーションと Supabase プロジェクト資産（auth は Neon Auth へ移行済み、AUTH-2 #950）
- `docs/` — アーキテクチャ、運用手順、イテレーション資料、実装計画
- `Makefile`、`package.json` — ルートに残すツール入口。`workers/edge/wrangler.toml`（edge Worker 設定）はコードの隣に配置

## ドキュメント

- [アーキテクチャ](docs/ARCHITECTURE.md) — システム設計リファレンス
- [デプロイ](docs/ops/deployment.md) — Cloudflare Workers デプロイガイド
- [マイグレーション境界](docs/ops/migrations.md) — Prisma チェーンの権威と、誰が適用してはならないか
- [運用ドキュメント](docs/ops/README.md) — 運用手順と環境向けランブック
- [イテレーション資料](docs/iterations/README.md) — task plan、progress、findings の保存場所
- [実装計画（アーカイブ）](docs/archive/plans/) — 過去の実行計画（平層 `plans/` には新規を置かない）
- [設計仕様](docs/specs/) — 現行のプロダクト/アーキテクチャ仕様
- [エージェントガイド](AGENTS.md) — monorepo 構成・コマンド・横断ガードレール
