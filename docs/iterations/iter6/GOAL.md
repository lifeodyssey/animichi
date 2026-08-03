# GOAL — iter6 清扫战役与 staging 上线

立于 2026-08-03。本文件是本轮工作的验收契约:条件全部满足即 iter6 结束,进入 S2 功能线。

## 一句话

**把 staging 变成一个真实可用、可观测、可回滚的环境,并把支撑它的代码与流水线清理到能长期维护的状态。**

## 完成条件(全部满足才算达成)

### A. staging 真正站起来

- [ ] 四组件全绿部署:catalog+Pulumi ✅ / users ✅ / web ✅ / **root 容器仍失败(#694)**
- [ ] `/healthz` 返回 200,post-deploy 烟测通过
- [ ] 匿名聊天走通一次真实对话(Turnstile → 限流 → 配额 → 容器 → Neon)
- [ ] Neon Auth 登录走通一次(magic link → JWT → edge 验证 → 用户数据)
- [ ] photo-search 走通一次(含 vision 计量落 daily_usage)
- [ ] retention cron 在 Workers Cron Triggers 上真跑过一轮(#692 已合,待验证)

### B. 交付链可信

- [ ] 部署不再被静默跳过(#691 已修,须由一次真实部署证实)
- [ ] 烟测目标 URL 不再硬编码个人子域(#695)
- [ ] 部署没发生 / cron 失败 / 容器错误率异常 → **有告警**(#678)
- [ ] 回滚手册可执行(#680),Worker 层秒级止血路径演练过一次

### C. 代码与流水线可维护

- [ ] iter6 Wave 1 全部合并 ✅
- [ ] Wave 2 十卡合并(B1✅ B2 B3 B4✅ B5 B6 B9 D3 E1 E2)
- [ ] Wave 3 五卡合并(C1 迁移 / C4 类型收敛含 #663 / C5 Clean Arch / C2 拆分 / C3 docs 瘦身 / L1 lint 全线)
- [ ] CI-1 per-package pipeline 落地到第 4 步(artifact 契约 + attestation)
- [ ] 所有 PR 的 robot 线程逐条读判(不是批量 resolve)

### D. 治理落到机器上

- [ ] Pulumi ESC 成为唯一密钥账本(#674 C2/C3)
- [ ] DB 角色矩阵生效(#685),GRANT 不再是装饰
- [ ] 依赖规则由 import-linter / oxlint 守卫(#666)
- [ ] 模型密钥收敛到 MiMo-only(#684,依赖 #656 vision 重设计)

## 不在本轮范围

- production 部署与域名上线(C6:staging 验通后立即做,但属下一轮)
- S2-S6 功能开发
- 战术 DDD、turbo、SLSA L3、changesets(均有明确否决理由,见决议册)

## 执行原则

1. **每卡零混入**:纯删除不带重构,重构不带行为变化,迁移不与功能同卡。
2. **设计先行**:C2/C4/C5/L1/CI-1 已有 owner 批准的设计稿;新的大改同样先出稿再动手。
3. **机器守卫优于纪律**:任何"以后要记得"的约定,当场变成断言,否则不算完成。
4. **绿色不等于完成**:部署要看副作用(SHA/端点/日志),不看 run 的颜色。
5. **PR robot 线程全部处理**:有效则修,无效则记录理由,不留未判定项。

## 当前阻塞

| 阻塞项 | 卡住谁 | 需要谁 |
|---|---|---|
| root 容器起不来(#694) | A 全部 | 待诊断(CF Containers 运行时日志) |
| artifact retention 当前值未知 | CI-1 第 4 步 | **owner** 去 Settings 读一眼 |
| `sha_pinning_required` 开关 | 安全加固 | **owner** 一次点击 |
| Pulumi/R2/CF 三组凭证曾贴进对话 | 安全 | **owner** 轮换 |
| #656 vision 重设计 | #684 密钥收敛 | 设计 + eval |
