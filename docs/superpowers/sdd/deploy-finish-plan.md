# Deploy 收尾计划 (scratchpad) — 2026-07-02 (原文件被 merge 清理,重建)

严格照此走。偏离 → 先在本文件调计划、再改代码,不盲试。

## 目标
main deploy promotion 端到端:CI → deploy-staging(atlas→pulumi→wrangler) → post-staging → ⏸prod-approve → deploy-prod → post-prod

## 进度
- [x] 1-3. #206 merge conflict(仅 `_deploy-component.yml`)解决:`checkout --ours` 保 scope 版 + merge commit `8901d9c` → **#206 MERGED**
- [ ] **3.5 commit+push `atlas.sum`**(checksum fix,已 hash、本地 validate exit0)
- [ ] **3.6 清 CI 残留孤儿 `atlas_schema_revisions` schema**(待用户授权 DROP)
- [ ] 4a. deploy-staging → atlas(checksum + scope 都修后应通)
- [ ] 4b. pulumi up(**盯 staging stack init**)
- [ ] 4c. wrangler deploy
- [ ] 5. post-staging(api,honest TODO)
- [ ] 6. **prod approve — 醒目高亮喊用户去点**
- [ ] 7. deploy-prod → post-prod
- [ ] 8. 提醒 rotate(chat 暴露的 R2/PULUMI creds)

## 偏离日志
- **步 4a**:预期 pulumi 挂,实际 **atlas 又挂**,两层根因:
  ① `atlas.sum` **checksum mismatch**(非 scope)→ `atlas migrate hash` 修(validate exit0)。
  ② CI 上次真 apply 在 checksum 挂前已 create `atlas_schema_revisions` schema、留新孤儿 → dry-run 又 not-clean。`schemas=["public"]` 无视 neon_auth 但**不无视 atlas 自己 revisions schema 的 name**。
  → 调整:插入步 3.5(push atlas.sum)+ 3.6(清孤儿)。checksum 修好 apply 成功 → 写 revisions → **幂等**、连环断。

- **步 4b 深化(2026-07-02)**:atlas 修好后 staging 挂在 **Pulumi up** = 计划预测的坑。
  - `error: no stack named 'staging'` → `pulumi stack init staging` ✓
  - staging 缺 config(infra `require`:`catalogDatabaseUrl` + `cloudflareAccountId`,共 2 个)。
  - **发现 infra 不用 `getStack()`**、靠 config 值区分环境;先前 `config cp prod→staging` 会把 prod DB 抄进 staging → 已用 `config set` 覆盖:`catalogDatabaseUrl`=staging Neon 分支 URL(secret)、`cloudflareAccountId`=共享值。
  - 写入 `infra/Pulumi.staging.yaml`(2 key,加密 secret 同 passphrase)。`pulumi preview --stack staging` CLEAN = **+2 to create**(stack + R2 `catalog-media`)。prod stack = 0 资源(从没部署)→ 现在建 bucket 安全。

## ⚠️ prod-time 缺口(step 7 前必须处理,现在不阻塞)
- **G1 资源名硬编码**:R2 bucket `catalog-media` 无环境后缀(infra 不用 getStack)。R2 名 account 内全局唯一 → 等 prod 部署会和 staging 撞。修:infra 给资源名加 `-${stack}` 后缀。
- **G2 NEON secret 共享**:`ci.yml` 里 staging+prod deploy 都用同一 `NEON_DATABASE_URL` GitHub secret(当前=staging 分支)→ prod worker 会连 staging DB。修:prod 用独立 DB secret。
- **G3 rotate 联动**:rotate `PULUMI_CONFIG_PASSPHRASE` 会让 `Pulumi.staging.yaml` 的加密 secret 失效 → rotate 后须重新 `config set` 重加密。

## 待办
- commit `infra/Pulumi.staging.yaml` → CI deploy 重跑(pulumi up 应过)。
