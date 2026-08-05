# 分支 / tag 清理盘点 — 2026-08-05

> **本文件只盘点,不执行任何删除。** 所有 `git push --delete` / `gh api -X DELETE` 由 owner 过目后手动执行。
> 范围:仅远端 refs(`origin`)。本地分支(含 `backend-survey`、各 `worktree-agent-*`)不在删除范围内。
> 卡任务书基线:「远端分支 56 个、tag 6 个、`delete_branch_on_merge=false`」——实测分支 56 个(+`main`)一致;tag 实测 **4 个**(详见 §5)。基线「6 个」是**按 `git ls-remote --tags` 输出行数误计**:4 个 tag 恰好输出 6 行,因为 `v0.2.0`/`v0.3.0` 是 **annotated tag**,各自多一行 `^{}` peel 行(指向 tag 对象解包后的 commit),两个 lightweight tag 各 1 行,合计 2+2+1+1=6 行。没有 tag 被删过。

---

## 0. 盘点方法(判定依据,非"看着像旧的")

| 数据 | 来源 |
|---|---|
| 分支最后提交时间 / 作者 | `git for-each-ref refs/remotes/origin`(committerdate / authorname),盘点前已 `git fetch origin --prune` |
| 是否合并进 main | 两条证据:① `git branch -r --merged origin/main`(仅匹配 merge-commit/ff 并入);② 逐分支 `git merge-base --is-ancestor <tip> origin/main`。本仓 PR 均为 **squash merge**,分支 tip 不是 main 的祖先,故 ① 对 squash 分支恒为"未列出",合并判据以 PR 状态为主 |
| PR 号与状态 | `gh pr list --state all --limit 300 --json number,headRefName,state,mergedAt,closedAt,author,title`(覆盖到 PR#751,远端现存分支对应 PR 全部命中,一对一无歧义) |
| tag 指向 | `git ls-remote --tags origin` + 强制 fetch tag 后的 `git log -1`;GitHub Release:`gh release list`(空) |

**分类规则**:
- **可删** = PR 状态 `MERGED`(内容已 squash 进 main;远端残留是 `delete_branch_on_merge=false` 导致)。
- **保留** = `main`、PR 状态 `OPEN`(在飞的 S0-v2 卡)、本卡分支 `chore/s0v2-A3-branch-tag-sweep`(未推送,计入保留)。
- **待裁决** = 无对应 PR 的分支(含 tip 已是 main 祖先的 `feat/s0v2-B5-vite-env-preflight`)。

---

## 1. 汇总

| 类别 | 数量 | 分支 |
|---|---|---|
| **可删**(PR MERGED) | **43** | 见 §2 |
| **保留** | **11** | `main`、9 个 OPEN-PR 分支(§3)、`chore/s0v2-A3-branch-tag-sweep`(本卡,本地未推送) |
| **待裁决**(无 PR) | **4** | `feat/s0v2-B5-vite-env-preflight`、`wip/269-bubble-map-salvage`、`wip/550-service-origins-salvage`、`wip/catalog-db-roles-salvage` |
| **合计(不含 main)** | **56** | — |

**tag**:远端实测 4 个(`v0.1.0` `v0.1.1` `v0.2.0` `v0.3.0`),全部建议删除(§5)。卡片基线「6 个」是 `git ls-remote --tags` 的 6 行输出——`v0.2.0`/`v0.3.0` 为 annotated tag,各有 1 行 `^{}` peel 行,实际只有 4 个 tag。

---

## 2. 可删 — 43 个(PR 已 MERGED,内容已在 main)

> 判定依据:PR 状态 `MERGED` + `mergedAt` 日期。squash merge 后分支 tip 不在 main 祖先链上属正常现象,非保留理由。

| # | 分支 | 最后提交 | 作者 | PR | MERGED 于 |
|---|---|---|---|---|---|
| 1 | `chore/766-retire-diag` | 2026-08-05 01:45 | Zhenjia ZHOU | #772 | 2026-08-05 |
| 2 | `chore/s0v2-trackA-cleanup` | 2026-08-05 14:45 | Zhenjia ZHOU | #786 | 2026-08-05 |
| 3 | `ci/485-rollback` | 2026-08-04 23:58 | Zhenjia ZHOU | #762 | 2026-08-05 |
| 4 | `ci/486-deploy-thin-caller` | 2026-08-04 21:09 | lifeodyssey | #753 | 2026-08-05 |
| 5 | `ci/487-infra-gates` | 2026-08-04 23:32 | lifeodyssey | #760 | 2026-08-05 |
| 6 | `ci/499-reusable-rename` | 2026-08-05 00:06 | lifeodyssey | #768 | 2026-08-05 |
| 7 | `ci/745-agents-refs-check` | 2026-08-05 02:06 | Zhenjia ZHOU | #774 | 2026-08-05 |
| 8 | `ci/750-integration-coverage` | 2026-08-05 10:14 | Zhenjia ZHOU | #780 | 2026-08-05 |
| 9 | `ci/actions-latest` | 2026-08-05 10:05 | Zhenjia ZHOU | #781 | 2026-08-05 |
| 10 | `ci/s0v2-B1-web-lane` | 2026-08-05 21:51 | lifeodyssey | #796 | 2026-08-05 |
| 11 | `ci/s0v2-B2-meta-asserts` | 2026-08-05 16:34 | Zhenjia ZHOU | #799 | 2026-08-05 |
| 12 | `ci/s8541-install-hardening` | 2026-08-05 10:21 | Zhenjia ZHOU | #782 | 2026-08-05 |
| 13 | `ci/smoke-coldstart-budget` | 2026-08-05 03:20 | lifeodyssey | #778 | 2026-08-05 |
| 14 | `docs/architecture-refresh` | 2026-08-05 00:59 | Zhenjia ZHOU | #771 | 2026-08-05 |
| 15 | `docs/s0v2-F1-agents-refresh` | 2026-08-05 15:40 | Zhenjia ZHOU | #791 | 2026-08-05 |
| 16 | `docs/s0v2-G1-naming-audit` | 2026-08-05 17:57 | Zhenjia ZHOU | #794 | 2026-08-05 |
| 17 | `docs/s0v2-spec` | 2026-08-05 14:30 | Zhenjia ZHOU | #787 | 2026-08-05 |
| 18 | `feat/s0v2-C1-showcase` | 2026-08-05 18:53 | Zhenjia ZHOU | #802 | 2026-08-05 |
| 19 | `feat/s0v2-C2-hero-mobile` | 2026-08-05 16:50 | Zhenjia ZHOU | #795 | 2026-08-05 |
| 20 | `feat/s0v2-C5-seo-close` | 2026-08-05 17:15 | Zhenjia ZHOU | #800 | 2026-08-05 |
| 21 | `feat/s0v2-C7-theme-upgrade` | 2026-08-05 18:26 | Zhenjia ZHOU | #806 | 2026-08-05 |
| 22 | `feat/s0v2-D2-ingest-seal` | 2026-08-05 16:14 | Zhenjia ZHOU | #792 | 2026-08-05 |
| 23 | `feat/s0v2-D3-ingest-retry` | 2026-08-05 17:28 | Zhenjia ZHOU | #803 | 2026-08-05 |
| 24 | `feat/s0v2-D4-catalog-cron` | 2026-08-05 21:28 | Zhenjia ZHOU | #805 | 2026-08-05 |
| 25 | `feat/s0v2-G2c-rename-agent` | 2026-08-05 22:32 | Zhenjia ZHOU | #808 | 2026-08-05 |
| 26 | `feat/s0v2-I1-auth-staging` | 2026-08-05 15:58 | Zhenjia ZHOU | #798 | 2026-08-05 |
| 27 | `fix/480-recompute-d13-d14` | 2026-08-04 23:48 | Zhenjia ZHOU | #763 | 2026-08-05 |
| 28 | `fix/557-geocoding-shared-client` | 2026-08-05 01:16 | Zhenjia ZHOU | #765 | 2026-08-05 |
| 29 | `fix/559-gate-token-hygiene` | 2026-08-05 01:07 | lifeodyssey | #764 | 2026-08-05 |
| 30 | `fix/694-container-coldstart` | 2026-08-05 02:31 | lifeodyssey | #773 | 2026-08-05 |
| 31 | `fix/postmerge-lifespan-robustness` | 2026-08-05 12:28 | lifeodyssey | #784 | 2026-08-05 |
| 32 | `infra/487-resource-hardening` | 2026-08-04 23:42 | Zhenjia ZHOU | #761 | 2026-08-05 |
| 33 | `infra/541-step6-gate-on` | 2026-08-05 17:02 | Zhenjia ZHOU | #789 | 2026-08-05 |
| 34 | `infra/769-ip-allowlist` | 2026-08-05 00:43 | Zhenjia ZHOU | #770 | 2026-08-05 |
| 35 | `infra/hold-web-routes` | 2026-08-05 02:56 | lifeodyssey | #777 | 2026-08-05 |
| 36 | `infra/staging-config-rule` | 2026-08-05 13:24 | lifeodyssey | #785 | 2026-08-05 |
| 37 | `infra/staging-domain-activation` | 2026-08-05 01:35 | Zhenjia ZHOU | #775 | 2026-08-05 |
| 38 | `infra/staging-gate-secrets` | 2026-08-05 11:58 | lifeodyssey | #783 | 2026-08-05 |
| 39 | `infra/web-routes-on` | 2026-08-05 10:00 | lifeodyssey | #779 | 2026-08-05 |
| 40 | `infra/zone-hardening` | 2026-08-05 01:27 | Zhenjia ZHOU | #776 | 2026-08-05 |
| 41 | `refactor/759-ten-line-batch` | 2026-08-05 01:53 | Zhenjia ZHOU | #767 | 2026-08-05 |
| 42 | `test/s0v2-C3-visual-pipeline` | 2026-08-05 17:42 | Zhenjia ZHOU | #801 | 2026-08-05 |
| 43 | `test/s0v2-D1-test-agents` | 2026-08-05 19:54 | Zhenjia ZHOU | #797 | 2026-08-05 |

---

## 3. 保留 — 11 个

### 3.1 `main`
默认分支,不动。

### 3.2 在飞的 S0-v2 卡分支(9 个,PR 全部 OPEN)

| 分支 | 最后提交 | 作者 | PR |
|---|---|---|---|
| `chore/s0v2-D5-mimo-only` | 2026-08-05 17:28 | Zhenjia ZHOU | #790 OPEN |
| `ci/s0v2-B3-supply-chain` | 2026-08-05 21:25 | lifeodyssey | #793 OPEN |
| `feat/s0v2-C8-cls-fonts` | 2026-08-05 23:14 | Zhenjia ZHOU | #807 OPEN |
| `feat/s0v2-C9-showcase-backend-deny` | 2026-08-05 22:32 | Zhenjia ZHOU | #813 OPEN |
| `feat/s0v2-C10-adopt-animal-island` | 2026-08-05 21:48 | lifeodyssey | #812 OPEN |
| `feat/s0v2-G2a-rename-web` | 2026-08-05 21:16 | Zhenjia ZHOU | #809 OPEN |
| `feat/s0v2-G2b-rename-edge` | 2026-08-05 21:43 | Zhenjia ZHOU | #811 OPEN |
| `feat/s0v2-H1-agent-src-layout` | 2026-08-05 21:28 | Zhenjia ZHOU | #810 OPEN |
| `feat/s0v2-H3b-1050-web` | 2026-08-05 23:17 | lifeodyssey | #804 OPEN |

### 3.3 本卡分支
`chore/s0v2-A3-branch-tag-sweep` — 当前 worktree 分支,盘点时尚未推送到远端(已确认 `git ls-remote` 无此 ref);随本卡 PR 推送后在飞,合并后由 owner 决定。

> 注:`backend-survey` 是 **本地**分支(远端不存在),不在远端删除范围内,天然保留。

---

## 4. 待裁决 — 4 个(无对应 PR)

| 分支 | 最后提交 | 作者 | 说明 |
|---|---|---|---|
| `feat/s0v2-B5-vite-env-preflight` | 2026-08-05 22:16 | lifeodyssey | **tip 是 main 的祖先**(`git merge-base --is-ancestor` = yes;`git branch -r --contains` 命中 main/C8/C9/G2c)——内容已进 main,但全量 PR 查询与 `gh pr list --search B5-vite-env` 均无对应 PR。疑似直接 push 合并或无 PR 直合。**建议:可删,等 owner 一句话确认** |
| `wip/269-bubble-map-salvage` | 2026-07-24 15:02 | Zhenjia ZHOU | 无 PR,距盘点 12 天,`wip/` 前缀、名字带 `-salvage`(抢救性分支,可能只是留档) |
| `wip/550-service-origins-salvage` | 2026-07-30 01:43 | lifeodyssey | 无 PR,距盘点 6 天,同上 |
| `wip/catalog-db-roles-salvage` | 2026-07-30 10:29 | lifeodyssey | 无 PR,距盘点 6 天,同上 |

三个 `wip/*-salvage` 均非 main 祖先、无 PR、无 release 引用 —— 若 owner 确认抢救已结束(内容已归档/无需再提),即可并入可删清单执行。

---

## 5. Tag 盘点 — 实测 4 个 tag / 6 行输出(基线「6 个」是行数误计,非 tag 数量)

`git ls-remote --tags origin` 实测输出 **6 行 = 4 个 tag**:`v0.1.0`/`v0.1.1` 为 lightweight tag 各 1 行;`v0.2.0`/`v0.3.0` 为 **annotated tag**(带 tag 对象,有 tagger/消息),`ls-remote --tags` 除 tag ref 行外还会为它们各输出一行 `^{}` peel 行(指向解包后的 commit),故 4 个 tag 占 6 行。`gh release list` 为空(无 GitHub Release 关联);部署为 merge-to-main 驱动、**非 tag 触发**(`docs/ops/deployment.md`),tag 无任何运行时作用。

| Tag | 类型 | 指向 commit | 日期 | 主题 | main 祖先 | 建议 |
|---|---|---|---|---|---|---|
| `v0.1.0` | lightweight | `6fc5875a` | 2026-04-26 | fix: codecov upload failure should not block CI | ✅ | **删** |
| `v0.1.1` | lightweight | `1056e59e` | 2026-04-27 | fix: remove stale pipeline import check from CI (module deleted in PR168) | ✅ | **删** |
| `v0.2.0` | annotated | `84e41444` | 2026-04-28 | v0.2.0 — Multi-turn context + route planning + observability | ✅ | **删** |
| `v0.3.0` | annotated | `d0174b36` | 2026-06-23 | Hybrid backend rewrite: Catalog Worker + Python agent + edge /v1 gateway + monorepo P0-P3 (#190) | ✅ | **删** |

补充证据:
- 4 个 tag 全部指向 4–6 月的历史 commit,均为 main 的祖先;其内容早已被后续迭代覆盖。
- 本地 tag ref 盘点前是陈旧副本(本地 SHA 与远端不一致),盘点时已将本地强制同步为远端 SHA;`git fetch` 报告的 `[tag update]` 只能证明两侧曾不一致,**不能判定哪一侧移动过**(本地侧另有 `backup-before-reconcile` 等痕迹,远端视为原件),不据此推断任何 tag 历史。
- 删 tag 结论仅依赖上述三点:**无 GitHub Release、部署非 tag 触发、4 个 tag 全为 main 祖先**,与两侧历史无关。若 owner 想留档版本里程碑,可改在 GitHub Release 上重建,而非保留 git tag。

---

## 6. 待 owner 执行 — 执行前必做(§6.0),随后才是删除命令块(本卡未执行)

> **执行顺序**:先做 §6.0 备份 + dry-run,再跑 §6.1–6.3 的删除;不要跳过备份直接删。

### 6.0 执行前必做(先备份、再干跑,最后才删除)

**① ref 全量快照(备份)**——覆盖远端**全部 refs**(56 个分支 + `main` + 4 个 tag),即 Track E 需要的 refs 全集;快照文件留存,不随删除失效,`--dry-run` 之外这是唯一的前置保护:

```bash
git ls-remote origin > refs-snapshot-2026-08-05.txt
# 或(更重,把全部 refs 落成本地 bundle 文件,可随时恢复):
git bundle create refs-backup-2026-08-05.bundle --all
```

**② `--dry-run` 干跑**——把 §6.1/§6.2 的命令原样加 `--dry-run` 先执行一遍,确认输出中被删 ref 的名字与 §2/§5 清单**逐条一致**(显式名字、无通配符、无手滑),核对无误后再去掉 `--dry-run` 正式执行:

```bash
git push origin --dry-run --delete chore/766-retire-diag chore/s0v2-trackA-cleanup ...
git push origin --dry-run --delete refs/tags/v0.1.0 refs/tags/v0.1.1 refs/tags/v0.2.0 refs/tags/v0.3.0
```

### 6.1 删除 43 个已合并分支

```bash
git push origin --delete \
  chore/766-retire-diag \
  chore/s0v2-trackA-cleanup \
  ci/485-rollback \
  ci/486-deploy-thin-caller \
  ci/487-infra-gates \
  ci/499-reusable-rename \
  ci/745-agents-refs-check \
  ci/750-integration-coverage \
  ci/actions-latest \
  ci/s0v2-B1-web-lane \
  ci/s0v2-B2-meta-asserts \
  ci/s8541-install-hardening \
  ci/smoke-coldstart-budget \
  docs/architecture-refresh \
  docs/s0v2-F1-agents-refresh \
  docs/s0v2-G1-naming-audit \
  docs/s0v2-spec \
  feat/s0v2-C1-showcase \
  feat/s0v2-C2-hero-mobile \
  feat/s0v2-C5-seo-close \
  feat/s0v2-C7-theme-upgrade \
  feat/s0v2-D2-ingest-seal \
  feat/s0v2-D3-ingest-retry \
  feat/s0v2-D4-catalog-cron \
  feat/s0v2-G2c-rename-agent \
  feat/s0v2-I1-auth-staging \
  fix/480-recompute-d13-d14 \
  fix/557-geocoding-shared-client \
  fix/559-gate-token-hygiene \
  fix/694-container-coldstart \
  fix/postmerge-lifespan-robustness \
  infra/487-resource-hardening \
  infra/541-step6-gate-on \
  infra/769-ip-allowlist \
  infra/hold-web-routes \
  infra/staging-config-rule \
  infra/staging-domain-activation \
  infra/staging-gate-secrets \
  infra/web-routes-on \
  infra/zone-hardening \
  refactor/759-ten-line-batch \
  test/s0v2-C3-visual-pipeline \
  test/s0v2-D1-test-agents
```

### 6.2 删除 4 个旧 tag

```bash
git push origin --delete \
  refs/tags/v0.1.0 \
  refs/tags/v0.1.1 \
  refs/tags/v0.2.0 \
  refs/tags/v0.3.0
# 若远端 tag 已漂移(remote != local SHA),删除命令仍按名字删除,无需本地同步
```

### 6.3 待裁决分支(owner 确认后执行;默认不删)

```bash
# B5:内容已在 main,owner 确认后:
git push origin --delete feat/s0v2-B5-vite-env-preflight
# wip salvage 三件套,确认抢救结束归档后:
git push origin --delete wip/269-bubble-map-salvage wip/550-service-origins-salvage wip/catalog-db-roles-salvage
```

> 若 wip/*-salvage 有留档价值,建议删除前先推一个 `archive/` 前缀分支或导出 bundle(沿用 §6.0 ① 的方式),再删;是否执行由 owner 定。

### 6.4 开关 `delete_branch_on_merge`(owner 在 GitHub Settings 手动开启,本卡不动 repo 设置)

开启后未来 merge 自动删分支,§2 这类堆积不再发生。

---

## 7. 执行后复核(删除命令跑完之后)

1. `git fetch origin --prune` + `git ls-remote origin`,预期只剩 `main` + §3.2 的 9 个在飞分支 + 本卡分支,远端 tag 为 0。
2. 与 §6.0 ① 的 `refs-snapshot-2026-08-05.txt` 对一遍被删 ref 名单,确认删除范围与清单完全一致。
3. 快照文件(`refs-snapshot-*.txt` / `refs-backup-*.bundle`)留存,Track E 需要 refs 全集时直接取用。

## 8. 声明

- 本盘点**未执行**任何 `git push --delete` / `gh api -X DELETE` / tag 删除 / repo 设置变更。
- 盘点过程中的本地动作仅:只读查询、`git fetch origin --prune`、tag ref 本地强制同步(仅改本地 refs,不改远端)。
- 佐证文件(盘点用临时产物:`prs.json`、`branches.txt`、`analyze_sweep.py`、`sweep_matrix.txt`、`report_rows.md`、`report_rows2.md`)盘点结束后已 `rm -f` 清理,工作目录根部无残留;本卡其余工作均在 `docs/ops/` 内完成。
