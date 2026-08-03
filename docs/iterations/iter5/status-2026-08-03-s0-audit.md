# Animichi 进度盘点 — 2026-08-03

对照 S0 卡片 × origin/main 代码 × 8/2 staging handoff 的全量核对结果。
上一份记录:[handoff-2026-08-02-staging-blocked](/private/tmp/handoff-animichi-2026-08-02-staging-blocked.md)(暂在 tmp,未入库)。

## 全景

```
S0 (基建)   8/10 卡实质完成;缺口 = S0.3 staging 验证 + S0.8 域名/ops(刻意推迟到 prod 后)
S1 (chat)   代码卡全部 CLOSED(含 iter5 遗留 #260/#282/#284/#273);未在任何真实环境验证
S2-S6       尚未开工,约 15 张开放卡
```

## S0 逐卡状态

| 卡 | Issue | 状态 | 证据 / 尾巴 |
|---|---|---|---|
| S0.1 eval 门禁分层 | #228 | CLOSED | PR #417 |
| S0.2 TanStack skeleton | #231 | **代码完成,卡未关** | PR #322(7/11 合并) |
| S0.3 部署链 + CI | #234 | 🔴 未完 | 代码全合(#324/#627);**staging 部署 8/2 首跑,web/root 两 job 失败**(见下) |
| S0.4 地图栈 | #237 | 🟡 尾巴 | ADR+spike+R2 路由全合(#321/#370/#628);缺:真实瓦片上传生产 R2、perf-mobile-cold 正式测量 |
| S0.5 DS token | #244 | CLOSED | PR #326 |
| S0.6 Landing/登录/i18n | #246 | **代码完成,卡未关** | PR #373 + #629 |
| S0.7 启动屏+删旧前端 | #248 | **代码完成,卡未关** | PR #630;`git ls-files frontend`=0,旧前端已删 |
| S0.8 SEO/域名 | #252 | 🔴 未完(刻意推迟) | 代码侧大半在(`apps/web/src/features/seo/`、robots/llms/sitemap);缺:Lighthouse CI、真 og-image(#549)、全部 manual/ops AC(DNS #541、GSC/Bing、301 #545) |
| S0.9 文档回填 | #262 | 🟡 尾巴 | migrations.md 在、Atlas 权威已定(#631);文档一致性守卫单测未确认,ARCHITECTURE.md 残留旧引用 |
| S0.10 契约强制 | #263 | **代码完成,卡未关** | PR #327(7/13 合并),OpenAPI drift 门禁在跑 |

## Staging 卡点(8/2 run 30737053650,8/3 复核仍成立)

成功:Pulumi、Atlas 迁移、catalog/users staging Worker + smoke。
失败的两个 job,均需 operator 动手:

1. `Deploy web staging` — GitHub `staging` environment 缺 Actions **variables**(非 secrets):
   `VITE_NEON_AUTH_BASE_URL`、`VITE_TURNSTILE_SITE_KEY`(8/3 查证仍未配)。
2. `Deploy root staging` — Cloudflare token 缺 account 级 `Containers Edit`,Containers API 403。
3. `staging.animichi.com` 无 DNS 解析(关联 #541/#325)。
4. 会话中曾泄漏一个凭证,operator 需轮换。
5. 待决定:docs commit `de070569`(`/private/tmp/animichi-docs-staging-prereqs.lYMpUk/repo`,
   仅 `docs/ops/deployment.md` 23 行)是否推成 draft PR。

新发现(handoff 之后):8/2 晚 `Purge anon_daily_message_count` retention 定时任务失败,待排查。

## 分支与文档卫生

- 5 个 `codex/s0-*` 远端分支:`git cherry` 证实全部 patch 级等价已入 main(squash merge 源分支),可删。
- 本地 `main`(1 月分叉)、`feat/frontend-rebuild`(落后 142 commit)均为废弃指针。
- 4 张僵尸卡待关:#231、#246、#248、#263(附证据评论)。
- `docs/iterations/iter5/progress.md` 停在 7/26,本文档为其 8/3 补充。

## 执行链

```
operator:配 2 个 VITE 变量 + 换 CF token + 轮换泄漏凭证 + DNS
  → rerun staging,逐 job 验收(DNS/HTTPS/JWKS//tiles/*)
  → staging 全绿 → production approval → S0 生产 smoke
  → S0.8 SEO/域名收尾 → S1 staging 边界内验证 → S2-S6
```
