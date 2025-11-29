# ADK Web 故障排除指南

## 问题：ADK Web 启动时报错 "No root_agent found for 'workflows'"

### 症状
运行 `make web` 时出现错误：
```
ValueError: No root_agent found for 'workflows'. Searched in 'workflows.agent.root_agent'...
```

### 根本原因
浏览器缓存了之前访问的错误 agent 名称。ADK Web 前端从 LocalStorage 或 URL 参数读取了旧的 `workflows` 名称，但实际的 agent 名称是 `seichijunrei_bot`。

### 解决方案

#### 方案 1：清除浏览器缓存（推荐）

**Chrome/Edge:**
1. 打开 DevTools (F12 或 Cmd+Option+I)
2. 进入 Application 标签页
3. 在左侧菜单找到 "Local Storage" → `http://localhost:8000`
4. 右键点击并选择 "Clear"
5. 关闭所有 ADK Web 标签页
6. 重新运行 `make web`

**Firefox:**
1. 打开 DevTools (F12 或 Cmd+Option+I)
2. 进入 Storage 标签页
3. 找到 "Local Storage" → `http://localhost:8000`
4. 右键点击并选择 "Delete All"
5. 关闭所有 ADK Web 标签页
6. 重新运行 `make web`

**Safari:**
1. 打开 Web Inspector (Cmd+Option+I)
2. 进入 Storage 标签页
3. 找到 "Local Storage" → `localhost`
4. 点击右侧的垃圾桶图标清除所有数据
5. 关闭所有 ADK Web 标签页
6. 重新运行 `make web`

#### 方案 2：手动指定正确的 agent

启动 ADK Web 后，手动访问：
```
http://localhost:8000/?app_name=seichijunrei_bot
```

#### 方案 3：使用隐私/无痕模式

在隐私浏览模式下打开 ADK Web，避免读取旧缓存：
- Chrome: Cmd+Shift+N (Mac) 或 Ctrl+Shift+N (Windows/Linux)
- Firefox: Cmd+Shift+P (Mac) 或 Ctrl+Shift+P (Windows/Linux)
- Safari: Cmd+Shift+N

### 预防措施

从现在开始，`make web` 命令会自动使用正确的 agent 名称启动，并在终端显示正确的访问 URL。

### 相关文件
- 启动脚本: `scripts/start_adk_web.sh`
- Makefile target: `web` (Makefile:47-48)
- Agent 定义: `adk_agents/seichijunrei_bot/agent.py`

### 常见问题

**Q: 为什么会出现 `workflows` 这个名称？**
A: 可能是因为项目重构过程中，曾经有一个名为 `workflows` 的模块或目录，浏览器记住了这个选择。

**Q: 如何确认 ADK 识别了哪些 agents？**
A: 运行以下命令：
```bash
uv run python -c "
from google.adk.cli.utils.agent_loader import AgentLoader
loader = AgentLoader('adk_agents')
print('Available agents:', loader.list_agents())
"
```

**Q: 清除缓存后还是不行怎么办？**
A: 尝试以下步骤：
1. 完全关闭浏览器（所有窗口）
2. 清理 Python cache: `make clean`
3. 重新安装依赖: `make dev`
4. 使用不同的浏览器
