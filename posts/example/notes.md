# Obelisk 技术复盘素材

> 工作记录：本文件会随着检索逐步更新。每个条目优先保留“为什么值得复盘”“可展开的技术线索”“证据锚点”，后续再统一收束。

## 检索范围

- 项目：Obelisk / quiet-zero。
- 来源：Claude Code 与 Codex session 历史、Obelisk 记忆层、summary、tool call / failure / subagent / workflow 记录。
- 目标：捞出开发过程中值得写成技术复盘的点，不局限于最终完成的功能，也包括架构取舍、检索语义、失败修复、工具化过程、产品边界。

## 候选复盘点

### 1. 从 “session-journal skill” 到 Obelisk：把 agent 历史变成可查询基础设施

**为什么值得复盘**：最初的问题不是“做一个历史浏览器”，而是让 agent 能查询自己的过往 session。技术选择落在 SQLite + FTS5 + JS query runtime 上，形成了后续 skill / app / memory layer 的底座。

**可展开线索**：

- 为什么选择让 agent 写 JS query，而不是把历史整理成静态文档或纯自然语言摘要。
- JSONL -> SQLite schema 的第一版边界：sessions、messages、tool calls、tool results、summaries、subagents、workflows。
- “CodeAct memory layer”的雏形：检索脚本返回证据，最终由 agent 综合结论。
- 早期一句核心判断是：`code as query language` 比自设计 DSL 更有表达力，真正难点在数据层而不是查询端。
- 早期已经明确 raw JSONL 太大太低层，agent 不应该直接解析 500MB transcript；需要离线索引层 + sandbox/lazy API。

**证据锚点**：

- Claude session `2831d8a1-df70-4365-a203-59bbe8e354cb`，标题 `Design agent-driven journal query system`。
- message `59452bc5-c5de-4154-b939-f97aecf12ba5`：提出离线索引层 + script sandbox lazy API，并判断 raw JSONL 不适合作为直接查询对象。
- message `e61ef599-0bb6-4f37-9ba8-3c5cf177cb91`：明确 skill 是最自然载体，不需要动 Claude Code 核心。
- message `ca83a264-7c03-4600-b136-6fa442fde3ed`：写下目标问题样例、“不设计固定查询 API，而让 agent 现场写 JS 查询脚本”。
- summary `da38c834-b4be-470c-a751-ecb6cca482df`：描述 “session-journal skill” 已能通过 SQLite + FTS5 查询 session history。
- workflow `wf_790243bc-e8a`：`session-journal-skill`，4 个 agents，约 179k tokens。

### 1a. 反 wiki 化：保留结构关联，而不是把历史压成页面

**为什么值得复盘**：Obelisk 的一个底层产品判断是：原始 session 本来就是结构化数据，过早把它编译成 wiki/markdown page 会压扁 tool calls、files、subagents、workflows、parent chains 等关系。这个判断解释了为什么 Obelisk 走 SQLite schema + query runtime，而不是 RAG/wiki。

**可展开线索**：

- “若无必要，勿增实体”：不要为了人类可读而制造一个中间知识库实体。
- agent 可以在应用层决定如何检索、聚合、总结和优化；底层要做的是保留关系和可查询性。
- 这条哲学后来延伸到 Codex 多源：不为 provider 特有 runtime crumbs 增加一堆旁路表，优先保留共同 transcript 模型。

**证据锚点**：

- Claude session `defd4ccd-b2d7-4c07-a32b-0a7b74e8aace`。
- message `8b77b3a6-9aed-40ca-977e-ca4292a9e6f3`：用户明确反对把 agent session 编译成 wiki，指出 messages、tool calls、tool results、files、subagents、workflows、parent chains 已经构成强结构。
- Codex message `codex:019ed12d-9667-74c2-bee7-22432b572bb0:000230`：Codex 接入时同样选择 lossy common model，避免 schema 暴露两个系统硬拼的复杂性。

### 2. 增量索引、JSON 截断与 raw()：索引系统里的“完整性 vs 可控体积”

**为什么值得复盘**：Obelisk 一开始就碰到历史数据规模和 JSONL 形态的问题。最终做了增量构建、长 JSON 截断、以及 `raw()` 窗口访问，体现了“索引用于检索，原始 JSONL 用于证据放大”的边界。

**可展开线索**：

- 增量构建 bug：session metadata 被覆盖。
- 10k 截断策略与 `raw(uuid, { offset, limit })` 的互补关系。
- 索引表 `index_state` 如何承担进度和 sentinel 状态。
- 第一版 runtime 被描述成三件事：建索引、提供查询 API、执行 agent 写的脚本。
- 早期 schema 已经有 `sessions/messages/tool_calls/tool_results` 和 FTS5；后续才演进到 summaries、subagents、workflows、memories 等更完整结构。

**证据锚点**：

- Claude session `2831d8a1-df70-4365-a203-59bbe8e354cb`。
- message `44762015-de26-40ad-bad1-9aba8e2dd3a0`：runtime 拆成建索引、查询 API、执行脚本。
- message `01d2d428-e52d-42bf-8d5d-667edeb9fd10`：第一版 SQLite 表结构和 FTS5 设计。
- summary `ea4dc391-c0b0-4942-87a9-4629d6525543`：提到修复增量索引、JSON 截断、`raw()` window access。
- summary `a0a22172-da29-4971-aa10-0d78ac450de3`：提到增量构建、JSON 截断、`raw()` 文档更新。

### 3. 查询 API 从零散 helper 到统一语义：filter opts、rank、cwd、skill、turn duration

**为什么值得复盘**：Obelisk 的价值很大程度来自 query API 的可组合性。开发过程中逐步把列表函数统一成 `project/after/before/limit` 等 filter opts，并补上 `sessions()`、`failures()`、FTS rank、cwd/skill/turn duration 等字段。

**可展开线索**：

- helper-first 的设计：什么时候用 `search()` / `summaries()` / `fileHistory()`，什么时候升级到 `sql()`。
- `failures()` 从文本匹配走向结构化 `is_error`。
- FTS5 rank 暴露给调用者，但文档要求不要误解 rank 数值。

**证据锚点**：

- Claude session `defd4ccd-b2d7-4c07-a32b-0a7b74e8aace`，标题 `readable-tool-calls`。
- summary `2c761a8a-a666-4197-8af1-43a27e5e51f7` / `f0e7cdc4-0a30-4ed9-bbc3-318e3928c86c`：统一 filter opts、增加 `sessions()`。
- summary `11e99729-ed75-4926-8b19-d402999fc2f5`：统一 opts 与 `is_error` 后，下一步讨论 `search()` 暴露 FTS5 rank。
- summary 片段显示后续加入 cwd、skill、turn_duration 三个索引字段。

### 4. schema 文档化：一次 column-name 错误引出的 agent-facing API 设计

**为什么值得复盘**：Obelisk 不是只给人写库，而是给 agent 使用。一次 “SKILL.md 没要求先读 schema.md，导致 raw SQL 字段名错误” 的问题，推动了 schema reference、query-patterns、retrieval-semantics、api-reference 的分层。

**可展开线索**：

- agent 工具文档不是普通 README，而是运行时行为约束。
- 为什么 `schema.md` 后来被拆成短 SQL quick reference + `api-reference.md`。
- 如何用 progressive disclosure 降低 agent 写错 SQL 的概率。
- 早期曾明确意识到“7 张表 + 10 个 JS 函数 + parent/child/sidechain/workflow 层级关系”会让 agent 还没写查询就先懵。
- 因此形成了 “SKILL.md 只放 `search()/context()/sql()` 简单入口，复杂分析再读 references/schema.md” 的 progressive disclosure。

**证据锚点**：

- message `67569fd4-9ccc-4b23-bd33-6ef3b25a9249`：指出底层 schema 过重，多数问题其实是搜索 + 上下文或聚合分析。
- message `eb81972a-34b0-4d25-9d43-e3c0bcba45c3`：提出 SKILL.md 简单入口 + references/schema.md 高级文档的两层结构。
- Claude session `feae9644-5454-46d2-ba25-7d1f8c92799b`，标题 `Discuss schema familiarity`。
- summary `a059e570-d310-41be-98bc-11ca26e570e1`：明确提到因 SKILL.md 未提示读 schema.md 导致 column-name errors。
- Claude session `d761b68b-eb31-468d-97dd-6080a40c98dc`，summary `6be63b82-24a6-4940-b1c9-7b5c147eec46`：后续 docs refactor，把 `schema.md` 拆成 compact SQL reference 与 `api-reference.md`。

### 4a. SKILL.md 重写：从工具说明书到 agent 检索契约

**为什么值得复盘**：这条线不能只归到 “schema 文档化”。`SKILL.md` 在 Obelisk 开发中经历了几次实质重写：从告诉 agent “可以 search/context/sql”，逐步变成一份检索行为契约，负责决定先读什么 reference、什么时候用 helper、什么时候允许 raw SQL、什么时候应该提议 memory 写入、以及如何避免把整个 session dump 出来。这是 agent-facing API 设计里很少被单独写清楚的一类工程经验。

**可展开线索**：

- 初始问题是 agent 会直接猜字段、拉整段 session、或者把 `thread()/raw()` 当默认入口；后来 `SKILL.md` 开始显式约束 “never pull entire sessions” 和横向/纵向放大证据。
- progressive disclosure 不是简单“把内容拆出去”：主 prompt 太薄，agent 不读 references；主 prompt 太厚，又会吞掉 attention。因此后来形成 “主文件保留强制路标和高频 schema contract，references 承载完整细节” 的结构。
- `pitfalls.md` 一开始像事后 debug checklist，但很多坑其实是查询前的设计语义，于是拆出 `retrieval-semantics.md`，把 Scope First、Plan Before Probe、Structure Before Text、Evidence Before Conclusion 提前成检索原则。
- `query-patterns.md` 的地位后来从“需要 copyable scripts 时读”提升为 broad synthesis / design history / weekly review 的默认路线，因为真实 agent 会觉得“我会写脚本，所以不需要模板”。
- memory layer 加入后，`SKILL.md` 又承担了权限和产品边界：普通 `--query` 只读，memory mutation 走用户批准后的 `--attune`；检索产出 durable conclusion 时要短促提议写 memory，但不能自行持久化。
- SkillOpt 评估暴露了 multi-file skill 的新问题：真实 skill dir 里 `SKILL.md + references/` 可以逐层读取，但某些 benchmark 只复制单个 `SKILL.md`，导致 reference 链接悬空。这说明 skill rewrite 还涉及分发/评估形态，而不只是 prompt 内容。

**证据锚点**：

- message `b92c87e9-d9d1-4b07-827b-5db2d7580565`：明确指出当时 `SKILL.md` 没有要求 raw SQL 前读 `references/schema.md`，这是导致 column-name errors 的 skill 设计缺陷。
- file edit `toolu_01DduoF2TMHq5tfY2Gf4Tnwn`：在 `sql()` 段落加入 “Before writing your first SQL query, read references/schema.md” 和 “Don't guess column names”。
- message `3435bf04-1ee1-475d-a450-6eb39fe8a592`：commit message 明确写到 “Rewrite retrieval strategy in SKILL.md: never pull entire sessions, navigate horizontally or vertically”。
- git commit `297ef01`：`refactor(docs): restructure SKILL.md into progressive-disclosure layers`，`SKILL.md` 246 行改动，同时新增 `references/query-patterns.md` 与 `references/pitfalls.md`。
- message `codex:019e754d-844f-7a62-8835-8c3ec2947759:006245`：讨论 progressive disclosure 的风险，提出主 prompt 必须保留足够强的 schema contract 和触发条件。
- message `codex:019e754d-844f-7a62-8835-8c3ec2947759:007478`：提出把 `pitfalls.md` 中的前置查询语义拆成 `references/retrieval-semantics.md`，并把主契约压成四条原则。
- git commit `dff88bb`：`refactor(skill): extract retrieval-semantics.md, compress pitfalls.md`，`SKILL.md` query routing 改为指向三层 reference。
- message `codex:019eaced-7a5f-7302-9b53-8cca3169b05a:001102`：用户回顾早期 15 轮试错后指出，新的 Query Routing、retrieval-semantics、query-patterns 让最近几次查询变顺，只剩 memory 写入 nudge 不够强。
- message `codex:019eaced-7a5f-7302-9b53-8cca3169b05a:001365`：把 `query-patterns.md` 从可选 recipe 提升为 synthesis 任务默认路线，避免 agent 直接走 raw SQL。
- git commit `89b53d4`：`docs: establish helper-first retrieval as default entry point`，把 helper-first / first-pass retrieval 写进主入口。
- message `20ec5ffe-f7a7-4b2f-acd7-7d6380908b25`：后期 staged diff breakdown 显示 `SKILL.md` 加入 Reference Map、`api-reference.md` 指针、memory mutation routing，`schema.md` 被缩成 compact SQL map。
- git commit `d5d5df4`：`docs: split schema.md into focused references (api-reference.md + compact SQL map)`，把 1200+ 行 schema 文档拆成 helper API reference 与短 SQL map。
- message `codex:019e754d-844f-7a62-8835-8c3ec2947759:006537`：SkillOpt v11 暴露单文件复制时 references 缺失，说明 multi-file skill 的评估/分发也会反过来影响 SKILL.md 设计。

### 5. indexer 错误处理硬化：从能跑到能长期吃历史数据

**为什么值得复盘**：session 历史是脏数据源：文件大、目录可能缺失、单个 JSONL 可能坏、工具输出可能巨大。Obelisk 早期专门做了一轮 indexer hardening：流式读取、每文件事务、错误日志、目录容错、SQL-side filtering。

**可展开线索**：

- 为什么对历史索引器来说，“部分失败不阻断全量索引” 比 fail-fast 更重要。
- 每文件独立事务与增量状态之间的关系。
- `failures()` 查询优化为什么应该在 SQL 侧做过滤。

**证据锚点**：

- Claude session `feae9644-5454-46d2-ba25-7d1f8c92799b`。
- summary `f1fe8169-9578-4d0c-8fe8-3f33c915440c`：streaming file reads、per-file transactions、error logging、directory traversal safety、SQL-side filtering。
- summary `77043029-b7b5-4fe9-a6f0-2665d550460b`：同一轮错误处理修复的中文摘要。
- failure example `toolu_01CnnbiT7bXeEz9GkFYnVBvX`：`failures()` 曾出现 “Provided value cannot be bound to SQLite parameter 14”，说明 query helper 的参数组装也是一类真实故障。
- failure example `toolu_014cRa9GWrYWh3fKzJGZ9F2T`：`search()` 曾出现 “no such column: outputs”，是 schema/query drift 的典型例子。
- failure cluster 统计：历史中较多失败来自 patch context drift（10 次）、ambiguous patch context（6 次）、schema/query drift（6 次）、SQLite parameter binding（1 次）、data shape assumption（1 次）。这些比单个 bug 更适合写成“agent 开发系统的失败类型学”。

### 6. Electron app：把 agent-first 检索变成 human browsing surface

**为什么值得复盘**：Obelisk 后来不只是 skill，还变成 Electron app。这个演进很值得写：同一份 SQLite 索引同时服务 agent query 和人类浏览，带来 UI、增量刷新、设置、recap、source health 等问题。

**可展开线索**：

- Skill side 与 app side 共享同一 SQLite index。
- session browser 如何把 tool calls、diffs、terminal output、file viewers 做成人能读的界面。
- app 的 empty-state flash、memory link focus-scroll、toolbar dropdown click-through 等 UI bug，说明历史浏览器的交互复杂度并不低。

**证据锚点**：

- Claude session `defd4ccd-b2d7-4c07-a32b-0a7b74e8aace`。
- `filesTouched` 统计显示 app UI 是主要复杂度来源：`SessionDetail.vue` 89 次 edit、旧 `render.js` 86 次、`detail.css` 75 次、`App.vue` 56 次。
- workflow `wf_138ba505-45f`：`electron-app-structure`，13 agents，约 585k tokens。
- workflow `wf_ca6c2d6b-d38`：`electron-app-migration`，状态 killed，说明曾有一次迁移路线被中止。
- summary `6f7e2c9d-cb3b-41dd-9a30-cdec1c8798b9`：Obelisk session history viewer + app screenshot。
- summary `0a31f069-9f7c-4af0-b13f-cf4a74c57baa`：memory link focus-scroll 跳到底部的 bug 修复。

### 7. workflow / subagent 驱动的大规模迁移：并行 agent 既是生产力也是治理问题

**为什么值得复盘**：Obelisk app 的结构、Vue migration、render split 等工作大量使用 workflow/subagent。它展示了一个工程问题：并行 agent 可以扩大吞吐，但需要明确边界、汇总、冲突处理和后续人工收束。

**可展开线索**：

- `electron-app-structure`、`split-render-js`、`vue-migration` 等 workflow 的任务拆分方式。
- killed workflow 与后续完成 workflow 的差别。
- 大规模 token 消耗如何换取架构探索速度。
- workflow metadata 自身也经历了一次 API 改造：`workflowTree()` 一开始容易 dump 大对象，后来被改成默认返回轻量目录（workflow 元数据 + agent phase/label/model/state/duration/tokens/tool_calls/messageCount），具体消息再按 agent_id 钻取。
- 这个改造来自真实失败：agent 拿到完整 tree 后容易 stdout/token 爆炸，违反 Obelisk 自己的 “不要 dump whole session” 原则。

**证据锚点**：

- workflow `wf_138ba505-45f`：`electron-app-structure`，13 agents，约 585k tokens。
  - phase 包括 `CSS Files`、`JS Files`、`HTML Shell`；agent label 包括 `css-sidebar`、`js-render`、`js-data`、`html-shell` 等。
- workflow `wf_716b3583-7c3`：`split-render-js`，6 agents，约 369k tokens。
  - phase 包括 `Split` 与 `Rewrite render.js`；label 包括 `usage`、`session-list`、`memory-list`、`sidebar`、`rewrite-render`。
- workflow `wf_82768628-4f3`：`vue-migration`，9 agents，约 499k tokens。
  - phase 包括 `Setup`、`Core`、`Views`、`Components`；`session-detail (retry 1)` 单 agent 消耗约 140k tokens，说明复杂视图迁移是瓶颈。
- workflow `wf_ca6c2d6b-d38`：`electron-app-migration`，killed。
  - 只有一个 `Build index.html / create-index-html` agent，状态停在 progress，说明“把 2400 行 mock 塞进一个 HTML”的路径很快被放弃。
- workflow `wf_790243bc-e8a`：初版 `session-journal-skill`，4 agents，phase 为 `Implement Runtime`、`Write Docs`、`Verify`。
- message `2cd10d3c-4707-42e6-97dd-cd14d9821b75`：指出 `workflowTree(runId)` 不应拉 500 条 message，而应先给轻量目录。
- message `3dabb823-aafb-4c57-9c97-7d4776452ea6`：进一步指出 `result_json` 未解析、workflow_agents 缺性能数据、缺 phase 信息。
- message `b853f99b-06d8-4778-af44-02dfc1b11f58`：发现 `workflowProgress` 里已有 phaseTitle、label、model、state、startedAt，只是 indexer 没用。
- message `33c778d2-a7ea-41b1-af5e-b43b656bdee3`：确认 `workflowTree` 改成轻量结构，不再 dump 所有消息。
- message `699b1ae1-a5f0-4f39-8393-9d174ab906bc`：总结 schema/indexer/query.mjs 三层改动。

### 8. Recap：从普通检索到“可分享的月/周复盘卡片”

**为什么值得复盘**：recap 是 Obelisk 从开发者工具走向自我理解产品的一步。它不是单纯 summary，而是把历史数据加工成主题化、可展示、可分享的卡片。

**可展开线索**：

- recap 是 output intent，不是单独 retrieval layer。
- app 侧 recap cards 与 skill 侧 `/obelisk recap ...` 的分工。
- theme port / card writing references 如何把检索证据转成面向人的叙事。

**证据锚点**：

- Claude session `defd4ccd-b2d7-4c07-a32b-0a7b74e8aace`。
- workflows `wf_7a332856-b3a`、`wf_31587729-9fe`：`recap-themed-port`。
- summary `beab101c-fda3-4d39-9108-b2da18065a7a`：app includes session browser、recap cards、settings。

### 9. Markdown memory layer：把“历史证据”升级为“人类批准的可复用结论”

**为什么值得复盘**：memory layer 解决的是一个更高层问题：检索每次都能找到证据，但 durable conclusion 需要被显式批准、落成 markdown、再注册为可召回记录。这比自动总结更保守，也更适合 coding agent。

**可展开线索**：

- memory 不是 raw evidence 的替代品，而是 prior notes。
- 写 memory 需要用户批准，mutation 分为 `remember()` / `forget()`，更新是 archive-plus-write。
- memory 与 session/message range、anchors、project scope 的关系。
- 设计曾在 “CLI 注册” 与 “JS API 写入” 之间摇摆：一开始讨论过 `runtime.mjs --remember --path ...`，后来判断 `remember()` 仍应是 CodeAct/JS API，而不是用户可见 CLI UX。
- 关键安全边界来自一次 review：普通 `--query` runtime 里暴露 `remember()` 会让任何检索脚本写 DB，和“用户必须批准”冲突。因此后续形成普通查询只读、确认写入后才暴露 mutation API 的 `--attune` 模型。
- memory 的产品味道也被校正过：不能强制 agent 输出固定 “Memory / Evidence / Consistency” 模板，Obelisk 应给 agent 更好的证据场，而不是把回答模板硬塞给它。
- `remember()` 路径语义后来被明确：相对路径优先按 source session 的 `project_path` 解析；无 source session 时才按 cwd；入库前必须存在且是普通文件，最终存绝对路径。

**证据锚点**：

- Codex session `codex:019eaced-7a5f-7302-9b53-8cca3169b05a`，标题 `Add markdown memory layer`。
- Claude message `b88b961c-3e99-42cc-b037-d5c26ce3a96b`：比较 CLI 注册与 indexer 自动发现两种 memory 写入方式。
- Claude message `e4220e90-1189-45d9-a1e0-dde194d8b352`：提出 `remember()` 作为 sandbox JS API，agent 先写 markdown 再注册。
- Claude message `1ba19ffd-c9e1-49dd-82be-6a1199ef5012`：第一版 memory layer 落地：`memories` 表、`memories()`、`remember()`、SKILL.md 文档。
- Codex message `codex:019eaced-7a5f-7302-9b53-8cca3169b05a:000159`：review 指出 `remember()` 在普通 `--query` runtime 里暴露没有真正的人类确认边界。
- Codex message `codex:019eaced-7a5f-7302-9b53-8cca3169b05a:000167`：用户明确纠正“不要强制输出格式”，并认为 `remember` 不应通过用户可见 CLI 调用。
- Codex message `codex:019eaced-7a5f-7302-9b53-8cca3169b05a:000169`：收敛到普通检索只有 `memories()`，用户确认后写入脚本才暴露 `remember()`。
- Codex message `codex:019eaced-7a5f-7302-9b53-8cca3169b05a:000512`：明确 `remember()` path 规范化、文件存在校验、相对路径解析规则。
- summary `efec60ce-f300-4c84-807d-80dcc875d7e1`：memory-to-session linking with focus-scroll。
- 当前 overview 显示 Obelisk 全局只有 1 条 memory，quiet-zero 项目内没有 active memory，说明该机制偏保守而不是自动泛滥。

### 9a. `sql()` 只读保护的副作用：安全 guard 也会成为可用性坑

**为什么值得复盘**：本次检索过程中也撞到一个 Obelisk 自身的 runtime 设计坑：`sql()` 的只读保护用正则扫描整段 SQL，所以当字符串字面量里出现 `REPLACE` 时，即使语句是 SELECT，也会被拒绝。这是安全约束与表达能力之间的小而典型的 tradeoff。

**可展开线索**：

- 只读 SQL guard 必须防止写操作，但简单关键词扫描会误伤合法查询。
- 更稳妥的设计可能是依赖 SQLite query-only、prepared statement 限制、或解析语句头而非全串关键字。
- 这类 guard 在 agent-facing runtime 中尤其敏感：误伤会让 agent 改写查询，甚至误以为 schema 有问题。

**证据锚点**：

- 当前检索脚本 `/private/tmp/obelisk_points_detail2.mjs` 初版因 `LIKE '%String to replace not found%'` 中的 `replace` 触发 `sql() only supports read-only SELECT/WITH queries`。

### 10. Claude + Codex 多源索引：统一 schema 下的 provenance、ID 与 UI 问题

**为什么值得复盘**：Obelisk 从 Claude Code session history 扩展到 Claude + Codex，是一次典型的 “same abstraction, different provider semantics” 迁移。它牵涉 ID 前缀、source 字段、Codex child threads、Settings 多数据源状态、source filter UI 等。

**可展开线索**：

- Codex ID 加 `codex:` 前缀防碰撞。
- Codex root threads 作为 sessions，child threads 映射到 `subagents`。
- Codex 不发 Claude-style workflow metadata，workflow 表在 Codex-only 历史里可能为空。
- UI 上需要 source health、source filter、隐藏噪音等能力。
- 最初的策略不是“无损保存 Codex runtime”，而是把 Codex 导入成 Obelisk 共同 transcript 模型：`sessions/messages/tool_calls/tool_results/summaries/index_state`。
- 讨论曾经过一轮反复：先考虑 `session_links/session_events` 旁路表保存 lineage/runtime events，后来用户指出表太多会干扰 agent 检索，于是收敛为 lossy common model。
- Codex 项目归属不能从路径推断，因为 `.codex/sessions/YYYY/MM/DD` 不按 project 组织；需要从 `session_meta.payload.cwd`、`turn_context.payload.cwd`、git branch/repository 等运行时 cwd 信号推断。
- 数据库路径迁移是多源支持的一部分：旧版放在 `~/.claude/obelisk.sqlite`，Codex 支持后迁到 product-owned `~/.obelisk/obelisk.sqlite`，旧路径只做兼容迁移，不把 Obelisk 继续绑在 Claude 或 Codex 任一 provider 目录下。

**证据锚点**：

- Codex session `codex:019ed12d-9667-74c2-bee7-22432b572bb0`，标题 `检查 ~/.codex session 格式`。
- Codex session `codex:019eda81-8b98-7013-8903-b6f8f5008efe`，标题 `比较 session skills 与 obelisk`。
- Codex message `codex:019ed12d-9667-74c2-bee7-22432b572bb0:000049`：指出 Codex 差异主要在 JSONL 外层事件流，不在存储目标。
- Codex message `codex:019ed12d-9667-74c2-bee7-22432b572bb0:000065`：`response_item.message/function_call/function_call_output` 可拆成 message/tool_call/tool_result。
- Codex message `codex:019ed12d-9667-74c2-bee7-22432b572bb0:000127`：给出 Codex JSONL 到现有表的初步映射表。
- Codex message `codex:019ed12d-9667-74c2-bee7-22432b572bb0:000147`：反对 Claude/Codex 分库，倾向统一 Obelisk index + source 字段。
- Codex message `codex:019ed12d-9667-74c2-bee7-22432b572bb0:000162`：推荐迁到 `~/.obelisk/obelisk.sqlite`，旧 `~/.claude/obelisk.sqlite` 做自动迁移。
- Codex message `codex:019ed12d-9667-74c2-bee7-22432b572bb0:000189`：Codex subagent 更像独立 rollout session/thread，关系靠 `forked_from_id` / `thread_source` / `source.subagent`。
- Codex message `codex:019ed12d-9667-74c2-bee7-22432b572bb0:000201`：现有 schema 能承载“可检索对话层”，但不能无损承载“运行时事件层”。
- Codex message `codex:019ed12d-9667-74c2-bee7-22432b572bb0:000230`：明确采用 lossy common model，不为 Codex 特有 runtime crumbs 暴露一堆旁路表。
- Codex message `codex:019ed12d-9667-74c2-bee7-22432b572bb0:000240`：Codex 的 project 依赖 cwd/git 信号推断，而不是目录结构。
- Codex message `codex:019ed12d-9667-74c2-bee7-22432b572bb0:000250`：完整 Codex 适配计划：迁移 home、尽量不动 schema、多 source discover、Codex id 前缀。
- tool result `codex:call_Dw1TVISxoyfiYL0Dtg1w89s8`：样本 `session_meta` 包含 `cwd/git_branch/cli_version/originator`。
- tool result `codex:call_UXByEExTyxL94TppskT02Kka`：样本 subagent metadata 包含 `source.subagent.thread_spawn.parent_thread_id`、nickname、role。
- 当前索引里的 Codex subagents：Lovelace / Nietzsche / Averroes 三个 child thread 被映射到 `subagents` 表。
- summary `019cc0c6-b291-4851-9951-8242add65838`：Settings page 增加 Claude Code + Codex 多源支持。
- summary `9e88f1a7-6a6e-4a0f-8fcd-b924b551cb8b`：调 source health 圆点。
- summary `81279880-4b6b-4d58-ac4f-a71e7ecfa32d` / `f883e456-d8c8-44d1-989b-b65ada90bc22`：source filter dropdown 点击穿透、hide noise 文案和高亮色等多源 UI polish。

### 11. 产品边界：Obelisk 不应该退化成 handoff 专用工具

**为什么值得复盘**：最近一次讨论明确收束了产品边界：Obelisk 的主价值是检索、证据综合、记忆层，而不是专门做 handoff。handoff 相关 transcript 语义可以提升检索可信度，但不应成为主叙事。

**可展开线索**：

- raw JSONL reading skills 更像 transcript semantics spec。
- Obelisk 应吸收 rewind / compaction / subagent provenance 来提升 retrieval correctness。
- “search/index first，raw JSONL only as drill-down” 是更适合 Obelisk 的路线。

**证据锚点**：

- Codex session `codex:019eda81-8b98-7013-8903-b6f8f5008efe`，标题 `比较 session skills 与 obelisk`。

### 12. 发行与开放策略：从个人工具到可安装技能 + macOS app

**为什么值得复盘**：Obelisk 后期涉及 README 重写、截图、v0.1.0 release、AGPL-3.0 license、Electron app packaging。这是一个个人 agent 工具走向可分发产品的过程。

**可展开线索**：

- skill 安装路径与 app release 的双重分发。
- 为什么选择 AGPL-3.0。
- README 从技术说明转成产品介绍：skill side + app side。
- 同 repo 但不同依赖边界：skill runtime 保持零依赖、复制可用；Electron app 是 optional companion，不应成为 skill 运行依赖。
- 这条边界避免了 skill 安装必须 `npm install`、拉 Electron/better-sqlite3/build 的复杂度，也让 agent-facing runtime 更稳。

**证据锚点**：

- Claude session `9d259960-8eae-4bae-947c-081420bb5626`。
- Claude message `47e6c10d-dbec-42d5-aaf9-1021025694c9`：明确同 repo 可以，但 Electron app 不应成为 skill 运行依赖；skill 零依赖，app 是 optional companion，两者共享 DB。
- summary `1c850db6-afc4-434f-8826-2eeb1048d045`：准备 v0.1.0 release。
- summary `beab101c-fda3-4d39-9108-b2da18065a7a`：license 改为 AGPL-3.0。
- summary `f41ddc7e-075f-470d-8822-ecf55ac8e79f` / `6f7e2c9d-cb3b-41dd-9a30-cdec1c8798b9`：README rewrite 与 app screenshot。

### 13. 用评估反向打磨 Obelisk skill：retrieval budget 比 prompt 漂亮更重要

**为什么值得复盘**：Obelisk 不只是被手工迭代，还被放进 SkillOpt/评估流程里检验。多轮结果显示：有时 “best skill” 没有改动，不是因为没有问题，而是 selection gate 饱和或评估没有覆盖真实失败；真正暴露的问题是 workflowTree/context/fileHistory 的 over-fetch 和 compact evidence discipline。

**可展开线索**：

- v6/v7/v9 这类训练轮次里，部分“提升”只是 rollout 随机波动，不一定来自 skill patch。
- `workflowTree` 大对象、context trace、fileHistory snippets 都容易让 runtime stdout 超过硬阈值。
- 评估集后来补了真实 gate-critical 场景：workflowTree compact、context compact、empty result 必须 search。
- 这条线可以连接到 Obelisk 的核心哲学：优化 agent 从历史里拿到可用证据的路径长度，而不是让 SQLite 查询本身更快。

**证据锚点**：

- Codex session `codex:019e754d-844f-7a62-8835-8c3ec2947759`，标题 `查找 GitHub 相似 skill`。
- message `codex:019e754d-844f-7a62-8835-8c3ec2947759:004704`：v6 没有训练出新 skill，baseline/final 差异主要是 rollout 随机波动；真问题是 workflowTree / fileHistory 输出过大。
- message `codex:019e754d-844f-7a62-8835-8c3ec2947759:005374`：full eval 有效结果约 18/20，剩余问题包含 development-history over-fetch 与 workflowTree。
- message `codex:019e754d-844f-7a62-8835-8c3ec2947759:005422`：明确判断 `workflowTree` API 形状不好用，应该提供 lightweight summary，默认不带消息全文。
- message `codex:019e754d-844f-7a62-8835-8c3ec2947759:005451`：提出四层优化：默认轻量 API、任务型 retrieval helpers、progressive disclosure、query budget + evaluator 反向训练。
- message `codex:019e754d-844f-7a62-8835-8c3ec2947759:005496`：v9 selection set 已满分导致 gate 饱和，test 仍暴露 context/workflowTree over-fetch。
- message `codex:019e754d-844f-7a62-8835-8c3ec2947759:005681`：新增 3 个真实场景卡住 workflowTree compact、context compact、empty-search-required。

### 14. Electron 分发打包：native module、沙箱与 macOS 系统工具的边界

**为什么值得复盘**：Obelisk app 打包不是“加个 npm script”这么简单。它涉及 renderer build、electron-builder、`better-sqlite3` native rebuild、mac arm64 产物、跨平台目标、Electron runtime 下载、本机进程资源限制、以及 DMG 生成需要跳出沙箱访问 `hdiutil`。

**可展开线索**：

- `electron-builder` 已存在，但最初脚本不会自动先构建 renderer，且只配置了 mac dmg。
- 为跨平台分发补了 `dist/dist:mac/dist:win/dist:linux`，mac `dmg/zip`、Windows `nsis/portable`、Linux `AppImage/deb`。
- `better-sqlite3` 是 native module，跨平台产物最稳应在对应平台构建；本机 macOS arm64 能可靠验证 arm64。
- 首次构建遇到 sandbox DNS、`spawn sh EAGAIN`、Electron runtime 下载、`app-builder_arm64 EAGAIN` 等系统/环境问题，需要区分配置错误与本机资源压力。
- zip 可在沙箱内生成，但 DMG 卡在 `hdiutil create failed - Device not configured`；提升权限后 `hdiutil` 成功，说明 macOS disk image 工具跨过了普通 sandbox 能力边界。
- 最终验证不仅看命令 0 退出，还检查 release 目录、app bundle、主程序和 `better_sqlite3.node` 架构。

**证据锚点**：

- Codex session `codex:019ec6ee-cebd-7431-9c93-ceec89a98a5f`，标题 `打包 electron-app 为各平台分发版`。
- message `codex:019ec6ee-cebd-7431-9c93-ceec89a98a5f:000045`：现有工程有 electron-builder，但脚本和目标配置不足。
- message `codex:019ec6ee-cebd-7431-9c93-ceec89a98a5f:000067`：指出 `better-sqlite3` 间接依赖和 production dependencies 收集风险。
- message `codex:019ec6ee-cebd-7431-9c93-ceec89a98a5f:000084`：补齐 `build/dist/dist:mac/dist:win/dist:linux`。
- message `codex:019ec6ee-cebd-7431-9c93-ceec89a98a5f:000100` / `000106` / `000118`：区分 GitHub 下载失败、npm spawn EAGAIN 和系统进程资源压力。
- message `codex:019ec6ee-cebd-7431-9c93-ceec89a98a5f:000144`：直接调用 Vite 成功，证明 renderer 构建配置无问题，EAGAIN 来自 npm script shell 层。
- message `codex:019ec6ee-cebd-7431-9c93-ceec89a98a5f:000248`：Electron runtime 下载成功后，`app-builder_arm64` 仍遇到 EAGAIN，说明打包配置已越过下载关口。
- message `codex:019ec6ee-cebd-7431-9c93-ceec89a98a5f:000285`：记录配置改动和未能生成最终安装包的系统级原因。
- message `codex:019ec6ee-cebd-7431-9c93-ceec89a98a5f:000375` / `000385` / `000391`：zip 成功、DMG 失败、根因为 `hdiutil create failed - Device not configured`。
- message `codex:019ec6ee-cebd-7431-9c93-ceec89a98a5f:000401` / `000407` / `000423` / `000429`：提升权限后 DMG 成功，最终 DMG/zip 均落盘并验证 arm64 bundle。

## 后续可选深挖

- 如果要写长文版，可以按时间线重构：`session-journal skill` -> query API hardening -> Electron app -> memory layer -> Codex 多源 -> release/packaging。
- 如果要写工程事故复盘，可以围绕 failure clusters 展开：schema/query drift、patch context drift、SQLite parameter binding、runtime stdout over-fetch、macOS packaging sandbox。
- 如果要写产品判断复盘，可以围绕三条主线：反 wiki 化、lossy common model、Obelisk 不做 handoff 专用工具。
- 如果要写 agent workflow 复盘，可以展开 `workflowTree` 的 API 改造，以及 `electron-app-structure` / `vue-migration` 的 phase 与 agent 治理。
