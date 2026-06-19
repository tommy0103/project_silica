---
title: "Execution Memory，而不是 Semantic Recall"
alt: "Semantic Recall"
hero: "It was here all along."
lede: "Obelisk 将 coding-agent memory 从语义相似片段的被动召回，变成了可查找、可审计、可复现的 execution memory。这篇文章记录了它是怎么来的，以及为什么它能工作。"
date: 2026 年 6 月
readTime: 15
repo: https://github.com/tommy0103/obelisk
repoName: github.com/tommy0103/obelisk
footerLine1: "Obelisk — execution memory for coding agents"
footerLine2: "写于 2026 年 6 月"
---

## 起因

已经很久没有自己写这样的长文了。Obelisk 的开发周期接近一个月，骨架部分基本一周多就做完了，剩下的时间都是优化，和写自己的论文。这也使我对于开发过程中遇到的一些问题，没有那么清晰了。

于是昨天，我想到可以让 Codex 用 Obelisk skill 来 synthesize 一下 Obelisk 的开发轨迹，看看它会有什么看法。看到结果之后我很吃惊。我认为这个生成质量已经超过了 wiki-based 的 agent trace / memory，并且它是**完全可以溯源的**。对于每一条可被复盘的点，它都给出了对应的依据，尽管我在 prompt 里完全没有要求，但它很好地利用了数据库提供给它的结构。

对于这一点，我是非常吃惊的，所以觉得不得不写一篇 blog 来记录一下。（下面有展示那份生成结果）

::: evidence notes.md "Obelisk 技术复盘素材 qwq"

::: 

在昨天晚上之前，我其实没有意识到 Obelisk 为什么能工作得这么好。因为它看起来只是把几样东西拼在一起，并没有使用任何新技术。SQLite、FTS5、JSONL、schema、query runtime，这些东西都不新。用数据库查询看起来和 grep 查 JSONL 也没有什么区别，这方面已经有不少人做过。如果这个 idea 真的能工作得很好，之前为什么没有人拿类似的思路去测 agent memory benchmark？

但我现在觉得，Obelisk 真正 work 的原因，可能不在于这些技术本身，而在于 coding agent 的 session 本来就不是普通的聊天记录。它更像一种 execution memory：有明确主干，有 project 边界，有 tool call 和文件路径这样的结构锚点，并且 agent 会不断复述自己的观察结果。也就是说，它天然就比 IM session 更像一个可以被查询的数据库。

Claude Code 早就通过 jsonl 为我们打造了一个良好的检索结构，但我们从来没有看过它一眼，甚至连 anthropic 自己也没有过。

而 Obelisk 就是那块不会忘记过去的方尖碑，现在你知道它的存在了。

> It was here all along.

## 递归结构中的上下文问题

时间倒回到 5 月中旬。我当时在设计自己的 coding agent，研究的问题是「对于一个递归的 agent 结构，把这个结构的上下文（中间上下文）拍平放进主 agent 的上下文窗口里是不合理的，那怎么不让主 agent 丢失掉这部分上下文？」

当时的一个想法是「可以通过比较好地设计 session 的存储结构，来让 coding agent 通过这个存储结构获取上下文」。但当时我还被困在 URI 表示里——想到用数据库存储结构，却没有想到通过 CLI command 和 fs 语义之外的查询方式。其实还是 Mintlify 那套 fs 语义的老东西，我自己做这套东西也做很久了，所以有路径依赖。

对 URI 表示的那套写法感兴趣的话，大概是：

```bash
hist search --keyword "FTS5 检索"
```

然后会返回一个 JSON 数组，给对应的结构什么的，结构可以是 URI 的结构，像是 `agent://<session-id>/<message-id>/...` 这样。

这个写法有几个很明显的问题。

一是检索频繁的时候 tool 调用过多，agent 在中间被回传了太多次信息。这就好比工作中有人给你发消息讲自己的需求，但每次只发一条消息，语焉不详，讲不清楚，你肯定会很急。Agent 虽然不会急，但 agent 的效率会被过多的工具调用拉低，并且多轮的工具调用也可能会造成 agent 的注意力漂移。

二是对于这套 CLI，你需要教它结构是什么样的，应该怎么去查询。这本质相当于设计了一种 DSL，agent 对于这套 DSL 的指令遵循程度未必高，所以抛开效率来说，检索效果可能也不好。

我当时其实很困惑这套东西能不能 work，所以就一直没动工。

## Dynamic Workflow 的启发

等到 5.29 的时候，Anthropic 发布了 dynamic workflow，我起先以为它解决了 RLM 落地的问题，但后来发现并没有，反而更加把主 agent 如何获取中间上下文这个问题摆上台面。

Dynamic workflow 是通过脚本来编排 agent 的，中间结果对于主 agent 是不可见的。这个设计是很显然的。如果中间结果对主 agent 可见，那就失去了子 agent 存在的意义：多个子 agent 的上下文会直接把主 agent 的上下文窗口撑爆，这显然不太合理。更直接来说，对于 Claude Code，它的 dynamic workflow 是一个工具调用，通过调用 `workflow()` 传入一段 script，主 agent 只获得这个工具的返回结果。

对于这样的一个结构来说，主 agent 能够通过一个检索层，按需拉取中间上下文，开始变得前所未有的重要了。从 subagent 开始，你和 agent 交互的范式就已经从单一的对话流、prompt loop，变成了一棵树。而现在有了 dynamic workflow，它进一步扩展到了一个 DAG。

> 从 subagent 到 dynamic workflow，agent 交互的范式从对话流变成了树，再变成 DAG。主 agent 按需拉取中间上下文，变得前所未有的重要。

## CodeAct 作为检索语言

于是就有了 Obelisk。

Obelisk 的存在最初是为了解决 dynamic workflow 类递归结构的中间上下文问题，但它的解法也被 dynamic workflow 启发。从看到 dynamic workflow 的第二天，我就意识到 JavaScript 脚本对 LLM 来说其实是 native 的，并且它也很适合用于检索。Agent 通过编写脚本一次拉取许多信息，并且把这些信息聚合在一起，作为一份 result，解决了我上面提到的第一个问题——多次工具调用带来的效率降低。同时它也解决了第二个问题：CodeAct 作为操作数据结构的方式，比 DSL 的理解成本更低。

它还多出来一个优点：在 CodeAct 中，各种 API 的组合是可以带来无限可能的。大家过去谈 bash native，但 bash pipeline 的组合是线性的，其可能性远不如 CodeAct 来得多。

## 从 Raw SQL 到渐进披露

第一版的 Obelisk 其实很简单，当时我脑海里只有一个简单的雏形：应当通过比较好地设计 API，来让 agent 可以组合这些 API 达到 1 + 1 远大于 2 的效果。当时只有一些最基本的 helper function API，像是 `search`、`sessions`、`messages`、`workflows` 之类的。实际上 agent 还是在用 raw SQL 检索，并没有起到我想象中的效果。

Raw SQL 当然是一种被允许的方法，因为 query runtime 跑在 V8 沙箱里，并且 SQLite 文件只是一个 raw trace 的 view，它并不是 source of truth。但每次都操作 raw SQL 肯定不是我所希望的。一方面是因为 SQL 对于 agent 来说并没有那么 native，写多了容易犯错；另一方面是因为组合 helper function 会有更好的 token efficiency。

我最开始对 helper function 的定位是，提供常用操作的 raw SQL 封装，避免 agent 每次都需要从头写 SQL。但后来我发现这并不足够。Helper function 其实还有一个很重要的作用：**可以控制 agent 的 token 开销**。同一个检索任务，用 raw SQL 写可能会没轻没重，但用设计好的 helper function，渐进披露地透露信息，就可以节省很多 token 开销。

### SkillOpt 与 overfetch

我发现这些问题是因为跑了 SkillOpt。SkillOpt 只是一个测试框架，它并不提供 benchmark，因此所有 benchmark 都是我基于本地 session 数据写的。在过程中我发现，有一个叫 `workflowTree` 的 helper，总是会返回超出 token limit 的数据，即使并不真的需要那么多。

是的，SQLite 的问题就是，不太可能会漏信息，但很可能会 overfetch。当 agent 使用 helper 的时候，首先应该给的是 summary，而不是原始 message。

::: diagram schema.svg
A graph, showing obelisk sql schema 
:::

## 为什么 Obelisk 能工作

这些都是 Obelisk 的工程问题。现在我们可以来聊聊开头那个问题了：为什么 Obelisk 能工作得这么好？

我想，过去几年里大家被向量检索的思想限制得太死了。而这又是有原因的，agentic AI 是最近两年里才出现的东西，有路径依赖是很正常的事情。

以向量检索为主的 RAG 兴起，一方面是因为人们不相信 AI 能自己查找到想要的东西。比起这一点，人们更愿意通过 RAG 把所有可能的相关碎片喂给它。在成本考量和注意力分配上，这是有道理的。但谈论效果，agent 应当比猜测它想要什么的 RAG 更明白自己想要找什么，却也是事实。

另一方面则是因为拟人的迷思。人们觉得记忆应当是无感被唤回的，因此不需要 agent 自身感知的 RAG / Memory System 自然更契合这种类比。但人们却忘了，对于一个长 session，我们自己也不可能只靠脑内 recall 就知道每句话都在讲什么，或者很快获取到自己想要的信息，而是也要通过软件内置的搜索引擎来查找。所以我觉得 Obelisk 的叙事其实从拟人上来说，也是更合适的。

::: callout
Agent 应当比猜测它想要什么的 RAG 更明白自己想要找什么——这是 Obelisk 成立的前提。
:::

## Execution Memory

这就不得不提到，coding agent 的 session 内容，其实是 **execution memory**。人们总是想着做一个通用的 memory 模块，却忽视了 memory 其实是有分别的。人们用一个特化的 memory benchmark（IM session，比如 LoCoMo）测出来的 memory 模块表现，和 execution memory 不应当直接相关，因为这本质是两个完全不同的东西。IM session 更像 social episodic memory，而 coding agent session 更像 execution memory。

直到昨天晚上坐下来思考 Obelisk 为什么 work 时，我才弄明白这点。问题的核心一直都是：coding agent session 和 IM session 的区别是什么？

**Agent session 是 topic-centered 的。** 一个 session 往往围绕某个任务推进，即使中途有 turning point，但也存在因果关系。而 IM session 可以是发散的，上句说下午的工作好辛苦呀，下句就可能聊到晚上吃什么。

**Agent session 是有明确主干的。** 它不会像群聊 session / 推特 session 一样，存在多条可能毫不相干的回复链，存在形式类似于稀疏森林。它的主干是明确被主 agent 和用户间的 message 所构成的，subagent 和 workflow 构成它的子树 / 子图。这也就导致了它的强结构性，使得 agent 从检索的任意一点扩展上下文都非常容易。

**Agent session 的产出是明确的，** 且产出可以验证 session 内容。代码 diff、测试结果、命令输出、文件路径，这些东西会不断把对话重新锚定到外部世界里。

**Agent session 间存在自然结构：** project、branch、时间线、memory。它不是一个平台强行切出来的聊天窗口，而是本来就围绕工作对象组织起来的历史。

这些共同使得明确的检索（像 FTS5）在许多 agent session 的问题上，比向量数据库的模糊检索更加合适。不是说向量检索无用，而是说它不应当默认定义所有 memory 问题。对于 coding agent history 来说，很多时候我们想找的不是"语义相似的片段"，而是"哪次改过这个文件"、"哪个 session 里遇到过这个错误"、"当时为什么放弃了那个方案"、"哪个工具结果支撑了这个判断"。

> 明确的检索在 agent session 上比模糊检索更合适——不是因为向量检索无用，而是因为它不应当默认定义所有 memory 问题。

## 设计上的判断

如果你前面认真看了 Obelisk SQL schema 的设计的话，你可能会注意到一个问题：tool result 完全是被单挂出去的。

这恰恰是 Obelisk 设计里一个很重要的判断：**tool result 不是默认的语义检索层，重要的是 agent 对 tool result 的复述。** 在日常和 agent 交互过程中，相信你也没有怎么看过 tool result（或者说是少数情况？）。这其实是因为 agent 会复述 tool result 的结果。如果 tool result 里有个 error，agent 不太可能会一声不吭，它就是这么被设计的。

所以 tool result 更像是证据后备层。平时检索主干里 agent 对观察结果的复述就够了，只有在需要审计、确认原始输出、或者怀疑 agent 误读了工具结果的时候，才需要展开 tool result。

另一个巧妙之处是，Obelisk skill 默认只让 agent 根据 agent session 的主干检索，而其他部分默认折叠，需要时也可以按需展开。这完全契合我们上面所分析的 agent session 的特点。Agent session 的主干本来就承载了大部分语义状态，而 tool result、subagent、workflow、raw JSONL 更像是可追溯的外部证据层。

## 结论

在我看来，Obelisk 的创新之处不在于用了什么新技术，而在于它重新定义了问题：它将 coding-agent memory 从语义相似片段的被动召回，变成了可查找、可审计、可复现的 execution memory。

这也是为什么我现在觉得 Obelisk 能 work 得这么好，并不是偶然。它不是在用数据库模拟一个通用记忆系统，而是在承认 coding agent history 本来就更像一个可查询的执行数据库。

> Agent transcripts are not chat logs; they are self-narrating execution traces.

优化空间还有很多。沙箱方面如何更安全，如果是自己的 coding agent，如何更好地设计字段，让这套检索架构更加 native，都是可以继续考虑的问题。我认为 Claude Code 的架构已经足够好，但仍然存在改进的空间。比如，如果把 message 和当前的 git status / git commit point 关联起来，会不会更好？
