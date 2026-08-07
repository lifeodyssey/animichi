# 命名归属:helper / util / manager 是设计气味

- **禁止 `helper` / `util(s)` / `manager` / `common` / `misc` 作为文件名或函数名**,以及泛指的
  `handler`、`_do_*`、`process_*`。这类名字等于承认「我不知道这段逻辑属于谁」——
  它意味着某处的 OOP/SOLID 没做到位。
- **按归属命名**:属于已有类型 → 该类型的方法或其模块内私有函数;属于尚未命名的概念 →
  **给概念命名**(值对象、策略、规格),文件名 = 概念名。测试构造器命名为**它构造的东西**
  (`make_selected_route_result`、`makeChatShellProps`),不是 `_helper` / `_setup`。
- **1-10-50 与 SOLID 冲突时,SOLID 优先。** 为凑 ≤10 行切出无归属的一段,是行数驱动的切割而非内聚;
  该重审原函数是否多职责,**按职责拆,不按行数拆**。
- 例外(不算气味):框架惯例位置——`conftest.py` 的 fixture、vitest `setup` 文件。

## 测试构造:优先 fixture,其次 builder

- **零参数的规范实例** → `@pytest.fixture`(TS:`test.extend`)。它自带 scope 缓存与跨文件复用,
  且天然按「提供什么」命名。有资源要释放时用 **`yield` 形态**(生成器 fixture),不要手写散落的清理。
- **带参数的变体** → Builder / Object Mother,按构造的概念命名;不要硬塞进 fixture 变成
  `request.param` 间接层。
- 同一维度的多变体 → `@pytest.mark.parametrize` / `fixture(params=...)`,不要复制粘贴测试体。
