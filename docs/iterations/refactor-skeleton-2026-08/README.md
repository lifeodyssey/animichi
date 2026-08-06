# Refactor skeleton 2026-08

| 文件 | 用途 |
|---|---|
| **[GOAL.md](./GOAL.md)** | **全波次 W0–W8 · 编排 · 合 PR 闸 · 勾选关账** |
| [PATH-DELTA.md](./PATH-DELTA.md) | 路径差 |
| [#829](https://github.com/lifeodyssey/animichi/issues/829) | 正式 spec |

## 合 PR 前（不可跳）

1. Matt `/code-review`（Standards + Spec）  
2. 行级 threads **全部**处理（inline + resolve）  
3. 顶层 bot findings 判定  
4. 顶层 `线程判定` / `findings triaged`  
5. CI 绿 → merge  

## 执行器

opencode-go **或** subagent；一 worktree 一写者；live ≤ 6。
