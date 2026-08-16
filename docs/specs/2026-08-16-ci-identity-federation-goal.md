# GOAL — CI identity federation (Builds doorbell + Pulumi Cloud)

- Status: TICKETS FILED (owner approved breakdown; spec = #1071 / `docs/specs/2026-08-16-ci-identity-federation-spec.md`)
- 卡片: #1072–#1081（全部为 #1071 的 sub-issue；原生 blocked-by 已建）
- 配套既有票: #1048 · #1051 · #1052（#1046 波次，本场不改那些卡）· #1045（由 #1081 关闭）

## 一句话

GitHub Settings 不再持有 deployer 身份：Worker/web 经 OIDC 门铃按 Builds；Pulumi 在独立 infra job 里用 Cloud + ESC。

## DAG

```
可立刻:
  #1072 owner bootstrap（Pulumi Cloud org / OIDC / ESC 空壳 / 门铃 Builds 连接）  [ready-for-human]

#1051 之后:
  #1073 门铃 Worker + HTTP 测

#1052 之后:
  #1074 staging 拆独立 infra job

#1073 + #1074 之后:
  #1075 staging web 走门铃

#1075 之后:
  #1076 staging catalog / users / root 走门铃

#1072 + #1074 之后:
  #1077 Pulumi Cloud backend + 托管加密 + OIDC
  #1077 之后:
    #1078 ESC 只喂 infra；禁 esc run wrangler

#1076 + #1048 之后:
  #1079 生产门铃 + SAFE-1
  #1079 之后:
    #1080 token-free rollback

#1078 + #1079 + #1080 之后:
  #1081 柜契约 + 删 GH 名 + close #1045
```

frontier：`#1072` 现在就能做。其余等 `#1046` 对应卡 CLOSED。
