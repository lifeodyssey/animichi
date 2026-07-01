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

## 待用户
授权 `DROP SCHEMA atlas_schema_revisions`(neon_auth/catalog 不碰)。
