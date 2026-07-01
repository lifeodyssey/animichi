# Atlas "not clean" on Neon staging — 决策 review

## 问题
`atlas migrate apply` 部署 catalog init 到 Neon staging 时报 `connected database is not clean`。
根因:Neon DB 自带 **`neon_auth`** schema(内置 Auth,**删不掉**),atlas 的 clean 检查是 **DB 级**(扫所有 schema),看到非自己管的 schema 就拒绝 apply。

## 实测结论(本地连 staging 只读 dry-run, atlas v0.30 对齐 CI)
| 尝试 | 结果 |
|---|---|
| 默认 revisions | `atlas_schema_revisions.atlas_schema_revisions does not exist`(追踪表没建成) |
| `--revisions-schema public` | `not clean: found schema "atlas_schema_revisions"`(前次失败的孤儿 schema) |
| 删孤儿 `atlas_schema_revisions` | `not clean: found schema "neon_auth"` ← neon_auth 删不掉,挡住 |
| URL `search_path=public` | 无效(clean 检查是 DB 级,search_path 只改操作 schema) |

**结论:删得掉的孤儿都删了;删不掉的 `neon_auth` 必然让 DB 级 clean 检查失败。**

## 候选方案
| 方案 | 做法 | 优 | 劣 | 实测 |
|---|---|---|---|---|
| **A. atlas.hcl `schemas=["public"]` + `--env neon`** | atlas 正式 schema 限定:只管 + 只检查 public | 干净、不妥协、atlas 正规 scope | 要确认 clean 检查真随 scope 走 | **未测**(被打断) |
| **B. `--allow-dirty`** | 承认 DB 非空,只把 migration apply 到 public | 一行、确定 work | "明知非空仍 apply",每次 deploy 都带 | 确定有效 |
| **C. `--baseline <version>`** | 标记基线版本、跳过 clean 检查 | atlas 官方"非空库"做法 | 语义是"已有该 migration 对应的 schema",neon_auth 非我方 migration、不对路 | — |

## 推荐
**先测 A(1 个 dry-run)**:atlas.hcl 的 `schemas` 是比 search_path 更强的正式 scope,理论上让 atlas 完全无视 neon_auth → clean。**A 成 → 用 A(最干净)。A 不成 → 退 B(`--allow-dirty`,确定能跑,代价是承认 Neon 库永远"非空")**。C 语义不对,排除。

## 待办(选定后)
1. 撤掉当前 `_deploy-component.yml` 里的 `--allow-dirty`(我之前加的、你拒过)
2. 按选定方案改 atlas 步
3. dry-run 验证 clean → commit → PR → merge → staging deploy 跑通 → post-staging → ⏸prod approve → prod 绿
