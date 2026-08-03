# iter6 — cleanup campaign

计划与决策记录:[../iter5/plan-2026-08-03-cleanup-campaign.md](../iter5/plan-2026-08-03-cleanup-campaign.md)
Milestone:iter6 — cleanup campaign(#635-#655 + #665 + #666)

## Wave 3 设计稿(owner 批准 2026-08-03)

| 卡 | 设计稿 | 要点 |
|---|---|---|
| C2 #652 | [design-C2-app-ts-split.md](./design-C2-app-ts-split.md) | 信任域拆分 + 显式信任链管道 + 顺序守卫测试 + Admitted 类型锁 |
| C4 #654 | [design-C4-type-convergence.md](./design-C4-type-convergence.md) | 9 张窄 Protocol(无 helper 层);第一批 = #663 修复 |
| C5 #666 | [design-C5-clean-arch-both-sides.md](./design-C5-clean-arch-both-sides.md) | 两侧 Clean Arch 归位:9 用例迁 application + import-linter / oxlint 依赖红线 |
| L1 #655 | [design-L1-lint-enforcement.md](./design-L1-lint-enforcement.md) | 1-10-50 全 workspace 强制;46 破线文件一次拆完;先修两个执法真空 |

方法论授权(owner):两侧统一 TDD / DDD(战略层)/ SOLID / OOP / Clean Architecture;
战术 DDD 不在授权内;依赖规则一律机器守卫。

## 决议与调研档案

- [decisions-2026-08-03.md](./decisions-2026-08-03.md) — 全域决议册(方法论/secrets/DB/CI-CD/网络/CF-native)
- [spec-infra-governance.md](./spec-infra-governance.md) — infra 治理 spec(#674,8 卡)
- [audit-cf-native-v2.md](./audit-cf-native-v2.md) — CF 全目录对照审计

## CI/CD 重构(#679)

- [design-CI-1-pipeline-refactor.md](./design-CI-1-pipeline-refactor.md) — v3 定稿(阶段模型 + 全量 artifact + 依赖图触发)
- [review-CI-1-fable.md](./review-CI-1-fable.md) — Fable 5 独立评审(7 条必改全部吸收)
