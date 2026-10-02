# 过程活动分组与折叠：源码调研及 AskTab 实施计划

> 状态：P1 核心功能已实现并通过验收；P2/P3 保留为后续计划。
> 调研日期：2026-10-02。
> 参考仓库：`D:/dev/nodejs/deepseek-harness`，基线 `639ed01539`。
> 当前仓库：`D:/dev/nodejs/ask-tab`，基线 `07d5965`。
> 适用界面：侧边栏和全页聊天，共用 `packages/ui` 的聊天组件。

## 1. 结论与实施范围

用户看到的「已完成分析」「已搜索代码」「执行了命令并已搜索代码」「已读取文件，执行了命令，已搜索代码」是**前端根据连续过程组生成的本地化标题**。它们不是模型生成的总结，不需要额外请求模型，也不是每执行一次工具就生成一条新的总结消息。

参考项目把以下职责分开：

1. 把流式事件及历史事件投影成有稳定身份的思考、工具、回复节点。
2. 按会话内容顺序，把相邻的思考和工具收进一个过程组。
3. 按工具调用 ID 去重、分类、计数，决定实时活动或结束摘要。
4. 用组级展开状态和展示模式控制可见性。
5. 对满足条件的已完成轮次，额外提供整轮过程折叠。

调研基线的 AskTab 已有单条工具折叠和连续工具的紧凑列表。本次在现有入口增量完成 P1，三个阶段的范围如下：

| 阶段 | 交付 | 是否改变消息协议/数据库 |
| --- | --- | --- |
| P1：核心功能 | 思考与工具连续分组、类别摘要、实时标题、整组手动折叠、历史数据兼容 | 不改变；由现有 `ChatMessage.parts` 推导 |
| P2：显示策略和阅读体验 | 四档模式、组内滚动跟随、查找与焦点、模式偏好保存 | 只增加设置字段 |
| P3：完整轮次能力 | 持久化 run/step/结束状态、精确最终答案识别、整轮折叠 | 需要扩展协议、存储和恢复链路 |

**P1 就能交付本次列举的批量摘要折叠。P3 才能对齐参考项目的整轮折叠语义。** 不把“最后一个助手消息”直接当成“一个完整轮次”，因为 steering 会把同一次运行拆成多个助手消息。

本文区分“参考项目现状”“AskTab 调研基线”和“实施方案”。P1 的落地路径及验证记录见第 9 节；P2/P3 和完整验收矩阵中的未来项不代表已实现或通过。

## 2. 参考项目的完整实现链

### 2.1 源码导航

下列链接定位本机此次调研的源码。行号可能随后续提交变化，复查时应同时搜索函数或类型名。

| 职责 | 源码入口 | 关键内容 |
| --- | --- | --- |
| 完整中文规则 | [README.zh.md](D:/dev/nodejs/deepseek-harness/packages/client/ui-chat/src/client/conversation-nodes/README.zh.md:1) | 分组、整轮、模式、分类、滚动和分页规则 |
| 实时/历史衔接 | [assistant-stream.ts](D:/dev/nodejs/deepseek-harness/packages/api/session-controller/src/client/sessions/assistant-stream.ts:109) | transient frame、durable settlement、重连重建 |
| 节点装配 | [assembler.ts](D:/dev/nodejs/deepseek-harness/packages/client/ui-conversation/src/client/conversation/assembler.ts:533) | 同一业务 ID 更新同一 Context |
| Assistant 投影 | [assistant.ts](D:/dev/nodejs/deepseek-harness/packages/client/ui-chat/src/client/conversation-nodes/assistant.ts:289) | `${turn}:${step}` 身份、reasoning/response blocks |
| 工具生命周期 | [tool.ts](D:/dev/nodejs/deepseek-harness/packages/client/ui-chat/src/client/conversation-nodes/tool.ts:246) | preparing → start → result；嵌套调用树 |
| 分组与增量更新 | [process-groups.ts](D:/dev/nodejs/deepseek-harness/packages/client/ui-chat/src/client/conversation-nodes/process-groups.ts:128) | 连续区间、稳定 group key、脏组刷新 |
| 分类与实时活动 | [process-activity.ts](D:/dev/nodejs/deepseek-harness/packages/client/ui-chat/src/client/conversation-nodes/process-activity.ts:7) | 分类、去重、排名、实时详情 |
| 结束标题 | [step-process.ts](D:/dev/nodejs/deepseek-harness/packages/client/ui-chat/src/client/chat/step-process.ts:11) | 前三类、中文连接词、共同前缀 |
| 中文字典 | [locale.ts](D:/dev/nodejs/deepseek-harness/packages/client/ui-chat/src/client/locale.ts:35) | 用户列举文案的直接来源 |
| 组级 UI | [ChatGroupSeat.tsx](D:/dev/nodejs/deepseek-harness/packages/client/ui-chat/src/client/chat/ChatGroupSeat.tsx:91) | 标题、模式、开合和组内容 |
| 组内滚动 | [use-process-scroll.ts](D:/dev/nodejs/deepseek-harness/packages/client/ui-chat/src/client/chat/use-process-scroll.ts:26) | 局部跟随、ResizeObserver、滚动位置 |
| 整轮边界 | [turn-process.ts](D:/dev/nodejs/deepseek-harness/packages/client/ui-chat/src/client/conversation-nodes/turn-process.ts:117) | 过程范围与最终答案锚点 |
| 中途输入检测 | [turn-process-presentation.ts](D:/dev/nodejs/deepseek-harness/packages/client/ui-chat/src/client/conversation-nodes/turn-process-presentation.ts:41) | steering 等输入阻止整轮隐藏 |

### 2.2 数据先归并，再分组

```text
Session 持久事件 + Assistant transient frame
  → 按 attempt / turn / step 对齐、结算和恢复
  → Assistant Node / Tool Node / 独立输入与状态 Node
  → 过滤 Chat 不可见节点
  → 同一 Turn 内划分连续过程区间
  → 统计类别、选择实时活动
  → 本地化标题 + 组级开合 + 展示模式
  → 可选整轮过程隐藏
```

同一个工具的准备、派发、结果都按 `callId` 更新同一节点；结果不是另一条需要重复计数的活动。成功 Assistant message 发布后，临时行仍保留到相应 `step/end`，防止“准备中工具”在正文结算和真正工具派发之间消失。

已经派发但缺结果的工具在终止边界可投影成中断结果；只有准备、尚未派发的残留可以隐藏。历史结果缺原始 call 时仍可展示，但不猜测原始调用参数和类别。

`run_code` 的嵌套工具通过明确的 `rootCallId / parentCallId / subCallId` 挂在工具树上。子 Session 的全部轨迹不会自动并入父组。启动子代理的工具已经返回结果时，即便子代理仍运行，也不会继续维持父组的“正在协调”状态。

### 2.3 分组到底以什么为边界

一组是**同一 Turn 内相邻的过程内容**。工具类别、Step 编号和工具成功/失败均不单独切组。

| 输入 | 参考项目处理 |
| --- | --- |
| 非空白 Assistant reasoning | 加入当前组；需要时才建立组 |
| Assistant 可见回复 | 关闭当前组，回复作为独立引用输出 |
| 同一 Assistant 同时有 reasoning 和回复 | reasoning 入组，response 在组外；原始节点仍只保存一份 |
| 工具或其他轮次内可见过程节点 | 加入当前组 |
| user、steering、turn-trigger | 关闭前组，输入独立显示 |
| model-retry、turn-error、turn-max-tokens、turn-tail | 关闭前组，状态行独立显示 |
| turn-process 控件 | 独立显示，但不切断正在收集的组 |
| 另一个 Turn 或无 Turn 的可见节点 | 截断同轮次的连续区间；无 Turn 节点自身独立保留，Assistant 也不拆分 reasoning/response |
| 隐藏节点、系统提示词、普通 context、permission command | 不进入可见输入，既不入组也不切组 |

回复要求有非空白文本、图片或其他可见块；reasoning 和工具协议块不算回复。没有成员就不生成组。相同消息 ID 的问答回复和触发通知只显示问答呈现，避免制造重复分隔。

```text
思考 → read → bash → 思考（下一 Step）→ grep → 最终回复
=> G[思考, read, bash, 思考, grep] → 最终回复

思考 → read → 阶段回复 → 思考 → bash → 最终回复
=> G1[思考, read] → 阶段回复 → G2[思考, bash] → 最终回复

read → steering → bash
=> G1[read] → steering → G2[bash]
```

这里有三个不能混用的状态：

- `closed`：这个过程区间是否已经被回复、分隔或轮次结束封闭。
- `open`：用户是否展开了这个组的正文。
- 工具结果状态：具体调用仍在运行、成功、失败或中断。

某个组可以 `closed=true` 且 `open=true`。它也可能因为出现回复而关闭，但仍含缺结果的工具。关闭时立即清空组摘要的实时活动和详情，保留类别计数；不能据此把成员工具改为成功。

`closed` 也不是永久单向状态：历史替换或可见性变化移除原分隔后，重新分组可使该组再次开放并恢复实时详情。普通内容刷新与结构重建必须区分。

### 2.4 活动类别与排名

参考项目只看记录的工具名，按表中顺序首次匹配，不转换大小写、不剥离命名空间、不分析命令内容。

| 类别 | 名称规则 | 运行中 / 结束文案 |
| --- | --- | --- |
| thinking（无工具活动时） | 不是计数类别 | 正在分析请求 / 已完成分析 |
| read | `read` | 正在读取文件 / 已读取文件 |
| readImage | `read_image` | 正在读取图片 / 已读取图片 |
| search | `grep`、`glob`、`*_inspect` | 正在搜索代码 / 已搜索代码 |
| write | `write` | 正在写入文件 / 已写入文件 |
| edit | `edit`、`apply_patch` | 正在编辑文件 / 修改了文件 |
| commands | `bash`、`pwsh`、`exec_command`、`write_stdin`、`terminal_*` | 正在运行命令 / 执行了命令 |
| code | `run_code` | 正在运行代码 / 运行了代码 |
| webSearch | `web_search` | 正在搜索网页 / 已搜索网页 |
| webFetch | `web_fetch` | 正在访问网页 / 已访问网页 |
| subagents | `subagent`、`subagent_*` | 正在协调子智能体 / 已协调子智能体 |
| plan | `todo_write`、`create_goal`、`update_goal`、`get_goal` | 正在更新计划 / 更新了计划 |
| questions | `ask_user_question`、`request_user_input` | 等待你的操作 / 向用户提出了问题 |
| tools | 其他名称 | 正在调用工具 / 已调用工具 |

例如 `terminal_inspect` 先命中 search；`functions.read`、`Read` 和 `send_message` 都落到 tools。不能把 shell 参数里出现 `rg` 当成独立 search 调用。

计数规则：

1. 去重范围是当前组；每个不同 `callId` 计一次，准备中、运行中、成功、失败、保留原 call 的中断都参与。
2. 父调用先计数，再按记录顺序递归子调用。父子 ID 不同就分别计数，不以叶子替代包装工具。
3. 重复 ID 连同其重复子树跳过；相同工具名但不同 ID 分别计数。
4. 只有结果、缺原 call 的根调用不计自身类别；已有子调用仍统计。
5. 思考不增加工具计数，Assistant 内的工具协议块不重复计数。
6. 类别按次数降序，次数相同按该类别首次出现顺序。没有固定“读文件优先”规则。

例：`read → bash → read → grep` 得到 `read=2, commands=1, search=1`；`run_code → [read, bash]` 得到三个各为 1 的类别，code 排在前面。

### 2.5 用户列举的文案如何生成

已结束组从排序后的类别取前三项，并使用本地字典组合，不在标题展示次数。

| 类别结果 | 标题 |
| --- | --- |
| 无类别（典型情况是只有思考） | 已完成分析 |
| search | 已搜索代码 |
| commands | 执行了命令 |
| tools | 已调用工具 |
| commands、search | 执行了命令并已搜索代码 |
| read、search | 已读取文件并搜索代码 |
| read、commands、search | 已读取文件，执行了命令，已搜索代码 |
| read、commands、search、tools | 已读取文件，执行了命令，已搜索代码等 |

两类用「并」连接，只有两项均以「已」开头才省略第二个「已」。三类用中文逗号，超过三类在前三项末尾加「等」。英文会将第一项之后的首字母转小写，并使用英文连接模板。

参考项目的零类别回退适用于所有 `counts=[]` 的已结束组，包括只有缺原 call 的结果等过程节点，不限定为纯思考。AskTab 在 3.4 对纯孤立结果另设标题，是有意改善。

这些完成态短语描述已记录的活动，**不保证成功**；错误必须仍能在成员行看到。

### 2.6 运行中的组标题

运行标题与结束排名采用不同规则：

- 从尚无结果的工具中，选择开始时间 `time` 最大的调用；相同时间取遍历顺序靠后的调用。
- 最新调用完成后，可退回更早且仍运行的调用；不依据最新一条输出的时间排序。
- 没有运行工具时显示「正在分析请求」。即便已经累计很多工具次数，也不使用结束摘要。
- 没有运行工具且存在运行中的 Assistant reasoning 时，取最近非空推理段落作为详情，去掉 `**` 标记。
- 标准模式在主标题后以 ` · ` 追加非空详情；简洁模式不追加。
- preparing 显示「准备读取文件」等；已知类别不解析尚未齐全的参数，只有通用 tools 类追加工具名。

详情字段优先顺序是：

```text
title, description, objective, task, task_name, name,
question, questions, prompt, message, command, cmd,
queries, query, pattern, url, uri, file_path, path,
target, action, status
```

选择第一个非空且支持的值。支持字符串、纯字符串数组；`questions` 特判取首个非空 `question`。不完整 JSON、补丁自由文本、无可用字段均回退工具名。合并空白后按 Unicode 字素簇限制为 160，省略号计入上限。

标题更新有 150ms 最短停留时间，期间只保留最新待显示标题；关闭组时立即显示结束摘要，不等计时器。它不是“等待 150ms 才建立分组”，也不是延迟工具执行。

### 2.7 三层开合与四档模式

显隐层级为：**整轮过程 → 连续过程组 → 单条思考/工具详情**。用户列举的标题属于中间一层。

| 行为 | compact | standard | detailed | verbose |
| --- | --- | --- | --- | --- |
| 组标题 | 类别摘要 | 类别摘要、实时详情 | 运行轮次隐藏；历史保留 | 隐藏 |
| 组正文 | 初始收起 | 初始收起 | 运行轮次直接显示；历史按手动开合 | 所有轮次直接显示 |
| 单条思考/工具正文 | 手动展开 | 手动展开 | 手动展开 | 手动展开 |
| 符合条件的已完成整轮 | 初始收起 | 初始收起 | 初始收起 | 始终显示 |
| 已结算思考预览 | 隐藏 | 首行预览 | 首行预览 | 首行预览 |

单条思考在流式期间也初始收起。其预览取最近一个“首行已经由换行结束”的段落首行；未完成的单行不预览。这与组标题取最后非空段落的规则不同。

参考项目 Desktop 默认 standard，Web 默认 detailed；旧 normal/expanded 值映射到 detailed。AskTab 计划两个入口统一默认 standard，不引入它的 Desktop/Web 默认差异，也不需要它的旧设置值迁移。

模式不进入分组算法；切模式保留同一组容器和成员父级，只改变标题显隐、正文显隐和限高。否则 React remount 会丢失内部展开、输入、选择与阅读位置。

### 2.8 整轮折叠的额外约束

参考项目的最终答案是**最后一个 Step 中已结算、有可见回复且不含工具调用块的 Assistant 回复**。正文留在整轮折叠范围外，其附带 reasoning 仍属于过程。阶段回复可以被整轮隐藏，但始终是过程组之间的独立正文。

以下轮次不允许整轮收起：仍运行、已停止、失败、过程开始后出现用户/steering/触发输入，或没有可折叠过程。其他已结束且有过程的轮次默认收起；没有最终答案也可收起全部过程。参考实现显式排除的是 aborted/error，max-tokens 等其他结束情况仍可能允许折叠；不能把它描述成“只有成功才能折叠”。尚未加载起点但已加载结束记录时可折叠已加载范围，只是不显示无法确定的耗时。

手动整轮展开状态与 Session、Turn、答案 Step 关联。收起整轮重置内部组及单条详情的开合；切模式则保留它们。自动收起会隐藏键盘焦点时应保持展开；手动收起先把焦点移到标题按钮。

### 2.9 稳定身份、增量、滚动和查找

- 新组初始 key 基于首成员业务 key 与 `groupPart`；历史 prepend 后若旧组成员仍完整连续保留，则沿用旧 key。拆组时不能让两组复用同一个 key。
- 普通 delta 只刷新所属组摘要；节点类型、可见性、轮次、是否存在 reasoning/response 或顺序变化才重建相关 Turn。未变化的 members、summary、节点引用继续复用。
- `assembly.ts` 对高频更新按动画帧合批，当前实现跨三次 `requestAnimationFrame`；即时事件直接 flush。AskTab 不必照搬这个调度器。
- 组正文间距 6px；有组头的展开正文限高 `min(400px, 50vh)`，两端 24px 渐隐，滚到边缘允许外层继续滚动。
- 手动展开活跃组从底部开始跟随；展开结束组从顶部开始、不自动追底。用户向上滚后暂停，回到底部恢复；组结束不重置阅读位置。
- 内外滚动器各自维护跟随意图。正文高度变化只应在相应读者仍选择跟随时追底。
- 折叠内容保留 DOM，使用可搜索隐藏与 `beforematch` 在浏览器查找命中后打开相应层；查找展开不强制跳到组头/底部。

## 3. AskTab 当前结构与差距

### 3.1 已有基础与正确改动入口

以下现状描述针对 `07d5965` 调研基线，链接所指文件已随 P1 修改；当前实现以第 9 节为准。

| 基线源码 | 基线现状 | 对接方式 |
| --- | --- | --- |
| [chat.tsx](D:/dev/nodejs/ask-tab/packages/ui/lib/components/chat.tsx:320) | 公共聊天入口 | 向 Messages 提供模式和必要运行状态 |
| [messages.tsx](D:/dev/nodejs/ask-tab/packages/ui/lib/components/messages.tsx:84) | 逐消息显示，特殊处理压缩/命令/子代理结果 | 保持独立边界；P3 再增加 run 级投影 |
| [message.tsx](D:/dev/nodejs/ask-tab/packages/ui/lib/components/message.tsx:32) | `buildRenderItems` 只合并连续非 document 工具 | 替换为统一过程组投影，仍保留正文原顺序 |
| [message.tsx](D:/dev/nodejs/ask-tab/packages/ui/lib/components/message.tsx:156) | tool-group 只是紧凑 div | 增加真正 ProcessGroup 标题和正文 |
| [message.tsx](D:/dev/nodejs/ask-tab/packages/ui/lib/components/message.tsx:301) | ToolCallPart 已有单条折叠、复制、结果展示 | 提取复用，不重写结果渲染 |
| [message-reasoning.tsx](D:/dev/nodejs/ask-tab/packages/ui/lib/components/message-reasoning.tsx:9) | live reasoning 初始展开 | 改为过程视图的显式开合策略 |
| [elements/reasoning.tsx](D:/dev/nodejs/ask-tab/packages/ui/lib/components/elements/reasoning.tsx:34) | 结束后 500ms 自动收起，局部计时 | 避免与新的受控状态冲突 |
| [tool-call-summary.ts](D:/dev/nodejs/ask-tab/packages/ui/lib/tool-call-summary.ts:37) | 单调用摘要和配色分类 | 继续用于单条行；另建过程活动分类 |
| [chat-types.ts](D:/dev/nodejs/ask-tab/packages/shared/lib/chat-types.ts:8) | parts 有 toolCallId，但缺 run/step/part 时间身份 | P1 派生；P3 补充协议 |
| [stream-handler.ts](D:/dev/nodejs/ask-tab/chrome-extension/src/background/agents/stream-handler.ts:299) | 按流顺序累积 parts，结果回写对应 call | P1 不改；P3 在这里记录事实 |
| [use-llm-stream.ts](D:/dev/nodejs/ask-tab/packages/shared/lib/hooks/use-llm-stream.ts:137) | 前端镜像 append/update；snapshot 替换 messages | 分组必须可由任意 snapshot 重建 |
| [use-scroll-to-bottom.ts](D:/dev/nodejs/ask-tab/packages/ui/lib/hooks/use-scroll-to-bottom.ts:67) | 外层滚动、点击抑制、Mutation/ResizeObserver | 新组内滚动独立管理，并做联动回归 |

聊天实际导入的是 `components/elements/tool.tsx` 和 `elements/reasoning.tsx`，不是 `components/ai-elements/` 下的同名组件。

### 3.2 现有数据链的关键事实

1. 普通运行通常累积到同一 assistant 消息；每次真正注入 steering 会结束当前 assistant segment，并产生用户消息和新的 assistant segment。
2. 同一模型 Step 可以先输出正文再输出工具调用。P1 必须遵守 `parts` 顺序，不把所有工具搬到正文之前。
3. 工具参数完整后，`onToolCallEnd` 才追加 `input-available`。虽然类型有 `input-streaming`，当前链路没有提供参考项目那种具名 preparing delta；P1 不伪造准备态。
4. 工具结果回写原 `tool-call.result/state`；截图等图片另追加 `file` part。P1 将这些图片保持在组外可见。
5. 后台已有 `onTurnEnd` 和 `LLM_STEP_FINISH(stepNumber, usage)`，但 UI Hook 未消费该事件，parts/历史没有绑定和持久化 step 信息。不是“后台没有步骤事件”。
6. 重试会清空当前 assistant parts，重新生成；快照恢复则整体替换消息。展开状态需要分别处理“同一记录更新”和“内容被重置”。
7. `StreamingStatus` 是界面当前连接/运行状态，历史消息没有可靠的独立结束原因；不能拿 `!isLoading` 当成“正常成功完成”。
8. 基线 `Messages` 用“列表最后一条”判断 isLoading，而 `Chat` 可在末尾追加子代理结果 system 消息。P1 已从 Hook 暴露当前 assistant message ID，并按 ID 定位活跃 segment；snapshot 已有 `assistantMessageId`，无需新增 wire 字段。delta 更新也按该 ID 定位，避免系统卡片插入后误判组结束或丢弃后续增量。

### 3.3 不可直接照搬的工具分类

当前 `ToolCategory` 的 `files/web/code/...` 用于图标配色，粒度不足以生成活动摘要。例如 read/write/delete 都是 files，但不能都说成「已读取文件」。

P1 新增独立的 `ProcessActivity`，按实际注册工具明确映射；以下是 AskTab 的产品选择，不是参考项目现有规则：

| AskTab 工具 | P1 分类建议 | 结束标题 |
| --- | --- | --- |
| read | read | 已读取文件 |
| write | write | 已写入文件 |
| edit | edit | 修改了文件 |
| list、delete、rename | files（新类别） | 已操作文件 |
| web_search、deep_research | webSearch | 已搜索网页 |
| web_fetch | webFetch | 已访问网页 |
| browser、明确注册的 browser 工具 | browser（新类别） | 已操作浏览器 |
| execute_javascript：execute/bundle | code | 运行了代码 |
| execute_javascript：register/unregister 等管理操作 | tools | 已调用工具 |
| memory_search、memory_get | memory（新类别） | 已检索记忆 |
| spawn_subagent、list_subagents、kill_subagent | subagents | 已协调子智能体 |
| debugger、scheduler、agents_list、chat_*、Google 工具、未知/自定义工具 | tools | 已调用工具 |
| create_document | 独立 DocumentPreview | 不纳入 P1 隐藏组 |

多 action 工具只对确认的 action 明确分类，未知 action 回退 tools；不要根据结果文案或任意名称子串猜测用途。可在后续细分“读取网页”等类别。

AskTab 当前内置工具没有参考项目那套 shell/grep 调用。应保留分类扩展点，只有明确工具元数据或已注册适配能证明 commands/search 时才显示「执行了命令」「已搜索代码」。不能把 JavaScript 或网页搜索误标为这两类来复刻截图。

### 3.4 旧数据和异常处理

新增一个不修改原消息的 normalization 层，集中处理以下情况：

- 缺 `state` 但有明确 result（包括 `null`、`false`、空字符串）或匹配的独立 tool-result：视为已返回；不从结果文本猜测成功/失败。
- 缺 `state` 且缺结果：不能沿用 UI 当前的 `?? 'input-available'` 推出永久 Running。非活跃 segment 显示“结果未知/未完成”，不转圈；活跃消息也只把明确的运行证据当成运行。
- 已结束/非活跃消息中仍残留 `input-*`：组标题可以结束，但成员标为结果未确认，不能永久显示执行中或擅自改为成功。
- 先识别 `isSkippedToolCall`，再统计错误；共享识别函数覆盖 tool-call 和独立 tool-result。P1 将明确 skipped 排除活动次数，保留“已跳过”行和数量提示，避免声称执行了未执行操作。全部成员都 skipped 时显示「已跳过工具调用」，不要回退「已完成分析」。这是相对 Harness“记录调用就计数”的有意调整。
- 停止导致的 `output-error` 仍保留原中断文案；它表示没有确认结果，不保证操作未发生。组可带独立的异常提示，类别标题仍只是活动描述。
- 独立 tool-result 与对应 call 按 ID 关联、只计一次。相邻或同一连续过程区间内的重复结果行可以吸收；跨正文/file/document 边界的结果保持原位置，使用结果引用行呈现，不把后来的结果移动到更早的正文之前。
- 孤立 tool-result 保留只读结果行，不虚构参数或一次调用。纯孤立结果组使用「工具结果」，不是「已完成分析」。

归一化结果区分 `running / returned / error / skipped / unknown` 等展示事实；不为了 UI 兼容而回写数据库或改变模型 transcript。

## 4. P1：实现连续过程组

### 4.1 已采用的模块划分

以下为 P1 实际新增/修改的核心路径。

| 文件 | 职责 |
| --- | --- |
| `packages/ui/lib/process-types.ts` | ProcessItem、ProcessGroup、ProcessSummary 和展示状态类型 |
| `packages/ui/lib/process-normalization.ts` | 将当前/旧 parts 转成带引用的过程项，关联结果和归一化状态 |
| `packages/ui/lib/process-groups.ts` | 纯函数分组，计算区间 closed、稳定 key |
| `packages/ui/lib/process-activity.ts` | 分类、ID 去重、排名、实时候选和详情 |
| `packages/ui/lib/process-title.ts` | 本地化标题组合，不依赖 React 和 DOM |
| `packages/ui/lib/components/process-group.tsx` | 持久组容器、标题按钮、正文与开合 |
| `packages/ui/lib/components/tool-call-part.tsx` | 从 message.tsx 提取已有 ToolCallPart，支持归一化状态 |
| `packages/ui/lib/components/message.tsx` | 接入新投影；复用现有正文、图片、文档、actions |
| `packages/ui/lib/components/message-reasoning.tsx` | 初始收起与独立手动开合，不被每次流更新重置 |
| `packages/ui/lib/components/tool-result-view.tsx` | 隐藏挂载后以 ResizeObserver 更新长内容溢出检测，保留展开全文选择 |
| `packages/shared/lib/chat-queue.ts` | 复用同一跳过识别规则，兼容独立 tool-result |
| `packages/shared/lib/hooks/use-llm-stream.ts`、`chat.tsx`、`messages.tsx` | 暴露/传递活跃 assistant ID，必要时提供 retry 的 UI reset generation |
| `packages/i18n/locales/{en,zh_CN,zh_TW}/messages.json` | 活动、连接模板、异常/未知/跳过等文案 |

保持依赖方向：`ChatMessage.parts → normalization → grouping → activity/title → React`。组只保存原始 part 的引用/索引，不复制大块工具结果，更不把摘要写回模型消息。

### 4.2 P1 分组契约

输入为一条 assistant segment 的 parts 和它是否仍处于当前活跃流。输出保留顺序的 `part` 或 `process-group`。

1. 非空 reasoning、普通 tool-call 进入 pending 组，reasoning 与工具之间不切组。
2. 非空 text、可见 file、DocumentPreview 关闭当前组并独立输出。只有空白的 text/reasoning 不制造空组或假边界。
3. 独立结果按照 3.4 处理；结果更新不是新的一次调用。
4. 消息边界硬切分，尤其不能越过 user/steering、压缩分隔、命令回复、子代理结果卡片。
5. 普通尾组只有在这个 assistant segment 仍活跃且没有后继边界时 `closed=false`。其余区间 `closed=true`，但不代表成功。
6. 不把 `LLM_STEP_FINISH` 当作过程组切分信号。P1 没有完整 step 元信息也不影响基本连续分组。

```text
flush(closed):
  pending 非空时输出一个组，保留成员顺序

for item in normalizedParts:
  if item 是可见过程:
    pending.push(item)
  else if item 是可见独立内容:
    flush(true)
    output.push(item)
  else:
    跳过不可见项，不制造边界

flush(!isActiveSegment)
```

一次工具即使只有一个成员也使用同一组 UI，纯思考也可形成一个组。不设“至少 N 次调用才能折叠”的额外门槛。

### 4.3 标识、状态和流式一致性

- 工具行 key 使用 `message.id + toolCallId`；reasoning/普通 part 暂用 `message.id + 原始 part index`，不使用经过过滤后的索引。
- 组 key 使用 `message.id + 首成员身份`，不包含标题、计数、数组长度、实时类别或 closed。append 与 result update 不更换组 key。
- 当前 parts 主要 append/update，原始索引在这些操作中稳定。重试清空 parts 时清理对应组状态；不得让新 attempt 继承旧内容的手动开合。若 React 合批使清空阶段不可观察，增加 UI 内存 reset generation，并由 Hook 的 retry 分支明确推进；不靠标题变化猜重试。
- snapshot 同一 message/call 的内容更新保留状态；切聊天、编辑截断、消息删除通过组件卸载清理开合状态。retry generation 按 message ID 保留在当前 Hook 生命周期内，历史消息不随其他消息重试而重挂载；Hook 卸载后释放。P1 不保存跨浏览器重启的展开选择。
- 只为新建组设置默认收起。不要在 `closed` 或结果到达的 effect 中无条件 `setOpen(false)`。
- 新增首个可见正文 token 立即结束前组；单条工具结果不会拆组。关闭后取消标题限频计时器，立即显示完成摘要。
- 缺工具开始时间的 P1 用“组中靠后的明确运行调用”作为实时候选；这是开始顺序的近似，不声称按时间精确还原并行活动。P3 有时间后再按时间取最大值。
- 保留当前“只有活跃消息末尾 reasoning 仍在思考”的判断，避免组内已经完成的思考行继续闪烁。

### 4.4 UI、国际化和错误可见性

默认 standard：组初始收起，实时组头显示活动和详情；展开后思考/工具详情仍初始收起。保留现有 ToolResultView、复制、文档点击和 MessageActions。

组头使用真实 button、`aria-expanded` 和 `aria-controls`；键盘 Enter/Space 可切换。类别图标表达活动，错误/跳过/未知另用紧凑提示表达，不以绿色成功图标代替活动类别。

完成短语和连接规则使用 `useT()` 对应的运行时 i18n。`MessageKeyType` 由英文 JSON 推导，因此先补英文键，再补简体/繁体；其他语言按现有机制回退英文。不要把中文「并/等」硬编码到通用算法，也不要声称本期会顺带翻译所有既有单工具英文摘要。

优先保留成员挂载，折叠只改变可见性。若使用现有 Radix Collapsible，必须明确 `forceMount` 与 hidden/CSS 策略；默认卸载内容会丢失 ToolCallPart 的局部开合，不能直接套用后就宣称状态保留。

首次落地用 `useMemo` 按消息 parts 派生，配合稳定 key 和组件 memo。无需第一阶段复制 Harness 的 Context/Slot/GroupStore 框架。遇到长历史性能瓶颈，再增加按消息和脏组缓存；不要每个 token 对全会话深拷贝或 JSON.stringify。

## 5. P2：模式、滚动与可访问性

1. 在 `packages/storage/lib/impl/settings-storage.ts` 增加 `processView: compact | standard | detailed | verbose`，缺字段/非法旧值按 standard 读取，不为读取默认值主动改写设置。
2. 在 `packages/config-panels/lib/settings.tsx` 添加“工作步骤展示”选择；通过设置订阅同步两个聊天入口，更新时合并现有 theme/locale。
3. 模式只改变同一组 DOM 的可见性和限高。P3 前 detailed 以“当前活跃 assistant segment”判断直接显示，无法准确识别同一 run 中更早的 steering segment；文案及验收明确这一阶段限制。
4. 新增组内滚动 Hook：手动展开活跃组定位底部，结束组定位顶部；用户离底停止跟随、回底恢复；组关闭或切模式不重置阅读位置。
5. 标准/简洁的手动展开正文采用 `max-height: min(400px, 50vh)` 和独立滚动；detailed 活跃正文、verbose 全部正文取消组级限高。滚动边缘可传递给外层，不设阻断式滚动捕获。
6. 联调外层 `useScrollToBottom`：开合点击、延迟 Markdown/图片布局、组内用户上滚期间不得被外层 MutationObserver 强行拖到底部。需要时明确传递“正在阅读组内内容”的抑制信号，不能只依赖现有 300ms 点击抑制。
7. 增加思考首行预览，遵守“完整首行”规则；不要复用组头最后段落算法。
8. 保留隐藏内容状态、焦点和浏览器查找。Chromium 验证 `hidden="until-found" / beforematch`；Firefox 需要实际验证，缺支持时保证普通展开和键盘访问，并记录查找能力差异。
9. 首轮 P1 已保证基本键盘操作；P2 补齐模式切换、查找展开、自动隐藏不丢焦点、减少动态效果和长列表阅读回归。

四档策略独立于分组结果。P2 不模拟整轮按钮，也不隐藏阶段正文；完整整轮策略在 P3 接入。

## 6. P3：补齐事实后实现整轮折叠

### 6.1 建议增加的最小事实

以下为设计草案，实施时统一命名；不是现有字段。

| 事实 | 归属/用途 |
| --- | --- |
| runId | 一次外层请求的稳定身份；steering 前后助手 segment 共用，不用当前 segment ID 代替 |
| attemptId | 重试身份，区分被清空的旧尝试与新尝试 |
| stepId / stepNumber | 绑定每次模型 Step，记录结算和有无工具调用 |
| partId 或稳定内容块范围 | reasoning/response 的精确引用，避免依赖可变数组位置 |
| startedAt / endedAt / terminalStatus / finishReason | 区分正常结束、停止、失败、超时、截断，计算真实耗时 |
| 输入来源及注入位置 | 区分开场输入、中途 steering 与下一轮 queued message |
| 工具调用开始时间、可选结果时间 | 精确选择运行中活动，避免 UI 接收时间跨视图不一致 |

建议为外层运行增加单独 `DbChatRun` 记录，以 `chatId/runId` 关联消息；消息增加可选 runId，step/part 元数据采用明确的类型结构。一个 run 的最终状态只维护一份，避免 steering 后多个 segment 的结束状态漂移。新增表/索引时编写对应 Dexie schema upgrade；可选字段缺失的历史消息无需强行回填。

如果需要与 Harness 一样显示“准备中”，再把 `toolcall_start/delta` 接入后台回调和 chunk 协议，使用同一 toolCallId 从准备态升级到参数齐全、派发、结果。没有这条数据链时继续只显示已知调用。

### 6.2 需要修改的链路

- `chat-types.ts`：类型、chunk/end/snapshot、step 关联与校验。
- `agent-setup.ts` 与 `stream-handler.ts`：在真实生命周期写 run/attempt/step 事实；利用已有 `onTurnEnd` 和 `turnPartStart`，但不能仅在结束时凭最终数组猜测边界。
- `use-llm-stream.ts`：消费 step/run 更新、retry reset；重连 snapshot 携带相同事实。
- `chat-db.ts`、`chat-storage.ts`：运行记录、完成/停止/错误持久化、删除与历史编辑同步清理；覆盖 export/import 或备份相关序列化路径。
- 消息读取映射、前后台保存、`finishModelTurn`、双视图订阅：完整保留新增 UI 元信息。
- 保持模型历史使用现有无损 `modelTranscripts`；过程组和本地化标题不进入发给模型的 messages，不影响签名和工具结果配对。

历史数据没有这些事实时只显示 P1/P2 组级折叠，不从正文末尾、创建时间或英语错误文本虚构正常完成状态、最终答案 Step 和耗时。

### 6.3 整轮投影与开合

在 `Messages` 上层增加 run 级投影：收集同一 run 的过程与阶段回复，保留独立输入/状态行，识别末 Step 的已结算无工具回复。先定义“过程范围”和“最终正文范围”，再应用 UI 开合。

- 正常完成且有过程、没有中途可见输入：默认收起过程，保留最终正文。
- 运行中、停止、失败、超时或 token 截断：保持过程可见；显示相应状态，不伪装正常完成。将超时/token 截断也排除在整轮自动折叠之外，是 AskTab 的保守产品选择，超出 Harness 只显式排除 aborted/error 的规则。
- 有中途 steering/user/触发输入：保持各组和输入原顺序，不提供整轮收起。
- 最终正文附带的 reasoning 仍可被过程折叠；正常完成却没有最终正文时，可折叠全部已知过程。
- verbose 始终显示过程；整轮状态/时长标题不提供收起动作。
- 手动整轮展开状态按 `chatId/runId/finalAnswerIdentity` 保存；收起整轮统一重置内部开合，切模式不重置。
- 自动收起若会隐藏焦点就保持展开；手动收起先转移焦点。
- 若以后新增历史分页，沿用旧组身份与阅读锚点，不把“全部历史加载完成”当折叠前置条件。

当前 AskTab 子代理进度是独立 UI 数据，不能递归到父组冒充持久化 subCalls。若以后增加可追溯嵌套调用，另行扩展明确 parent/root ID 和去重，不能从结果 JSON 猜工具树。

## 7. 实施顺序、测试与验收

### 7.1 建议任务拆分

| 顺序 | 工作 | 完成条件 |
| --- | --- | --- |
| 1 | 定义 P1 类型、分组和分类规则，建立真实 parts fixtures | 纯函数契约与旧数据策略可测试 |
| 2 | normalization、grouping、activity、title 及单测 | 规则矩阵通过；输出不修改输入 |
| 3 | 提取 ToolCallPart，接入 ProcessGroup 与 reasoning 策略、i18n | 两个聊天入口出现同一行为，现有结果/文档操作可用 |
| 4 | 扩展 mock LLM fixture，完成 P1 浏览器回归 | 流式、停止、重试、快照、steering、状态保留通过 |
| 5 | P2 四档设置、滚动、查找和焦点 | 模式不重挂载，长组阅读位置稳定 |
| 6 | P3 run/step 协议、存储与恢复 | live/snapshot/历史可重建同一事实，旧数据兼容 |
| 7 | P3 整轮投影与状态控制 | 正常/失败/插话/最终答案的折叠条件全部通过 |

每阶段可单独提交和评审。P1 验收不依赖 P3；P3 的 UI 应在持久化及恢复测试通过后接入。

### 7.2 必测行为矩阵

| 场景 | 预期 |
| --- | --- |
| 只有 reasoning | 一个组，结束标题“已完成分析” |
| 只有正文 / 全空白内容 | 不产生空过程组 |
| reasoning → tool → reasoning → tool | 同组，原顺序不变 |
| tool → 正文 → tool | 两组，正文始终在中间 |
| 同 Step 先 text 后 tool | text 独立在前，不重排 |
| file / DocumentPreview / steering / 压缩分隔 | 分界清晰，交付内容和输入不被 P1 隐藏 |
| call + result / 同 ID 重复更新 | 只计一次，结果更新不拆组 |
| 同工具不同 ID | 分别计数；次数相同按首次出现排序 |
| 0 / 1 / 2 / 3 / 4 类 | 前三类截断、中文共同前缀和英文连接均正确 |
| 全部工具完成但继续思考 | live 标题回到“正在分析请求” |
| 首个正文 token 出现 | 立即关闭前组，清空实时详情 |
| 多次快速活动切换 → 结束 | 150ms 只保留最新候选；结束立即显示 |
| error / skipped / unknown / 全 skipped | 不伪装成功，异常与跳过不混为一类 |
| 缺 state、result 为 null/false/空串 | 正确识别明确结果存在；不永久转圈 |
| 跨正文的独立 result / 孤立 result | 不丢内容、不重排、不虚构调用计数 |
| 打开组及某工具后追加 delta/result | 两层开合和内部状态保留 |
| 同消息重试清空 → 重新输出 | 不继承旧 attempt 的展开，不残留重复组 |
| 快照恢复 / 切聊天返回 / 历史重载 | 成员顺序和类别一致，不依赖错过的 delta |
| 活跃助手后追加子代理结果 system 卡片 | 活跃 ID 不丢失，后续 delta 仍更新原助手，卡片独立显示 |
| 组外最终正文与复制/文档 | 内容和交互不回归 |
| 420px 侧栏 / 全页 / 中英文 / 暗色 | 标题省略合理，无横向溢出 |
| P2 模式切换 | 分组、成员身份和手动开合不变 |
| P2 内外滚动 / 查找 / 键盘焦点 | 不抢阅读位置、查找可展开、隐藏不丢焦点 |
| P3 完成 / 失败 / 停止 / 超时 / 插话 | 只有允许的轮次能整轮折叠 |
| P3 最终回复带 reasoning / 无最终回复 | 正文保留边界正确，思考仍是过程 |

新增纯函数和 Hook 测试放在独立 `tests/unit/process-groups.test.ts`、`process-activity.test.ts`、`process-stream.test.ts`；符合本次 humanizer-coding 的测试隔离要求。当前 `vitest.config.ts` 收集 `.test.ts`，没有默认 DOM 环境，真实 UI 行为由 Playwright 验证。

浏览器测试位于 `tests/playwright/e2e/process-groups.spec.ts`，复用现有 extension fixture，在 side-panel/full-page-chat 两入口循环。`tests/playwright/helpers/mock-llm.ts` 已补充可控 tool calls、失败、工具能力与可选初始 reasoning；通过真实工具执行产生 result 和下一 Step，真实走后台→Hook→UI。历史兼容数据及子代理事件在 `process-fixtures.ts` 中准备。

既有 `background-chat-stream.spec.ts` 和 `message-queue-steering.spec.ts` 直接用 `toContainText` 检查 reasoning，这不等于检查可见性；按计划保留隐藏 DOM 时可以继续通过。新增测试必须先断言组头可见、正文隐藏，再展开组/详情验证正文可见，并检查组标题的实时提示。若实施中选择延迟挂载，需明确评估状态保留和相应测试变化，不能通过删除断言规避产品行为变化。

### 7.3 实施后的验证命令

以下命令用于复现 P1 验证，实际执行结果与未执行项见第 9 节。

```powershell
pnpm exec vitest run tests/unit/process-groups.test.ts tests/unit/process-activity.test.ts tests/unit/process-stream.test.ts packages/shared/lib/hooks/use-llm-stream.test.ts packages/shared/lib/hooks/use-llm-stream-snapshots.test.ts packages/shared/lib/hooks/use-llm-stream-queue.test.ts chrome-extension/src/background/agents/stream-handler-steering.test.ts
pnpm type-check
pnpm build
pnpm exec playwright test tests/playwright/e2e/process-groups.spec.ts tests/playwright/e2e/background-chat-stream.spec.ts tests/playwright/e2e/message-queue-steering.spec.ts tests/playwright/e2e/message-markdown.spec.ts tests/playwright/e2e/document-preview.spec.ts tests/playwright/e2e/message-edit.spec.ts
```

对修改文件运行 ESLint/Prettier 检查。P2 补模式设置和滚动回归；P3 额外执行新运行记录的存储、snapshot、错误/停止、重试、历史编辑、导出导入测试。修改 i18n JSON 后先完整构建；只运行窄范围 turbo build 可能沿用动态导入语言包的旧 dist 副本。

## 8. 调研证据与限制

最初调研阶段只检查了源码、类型、现有测试和参考项目中文规则文档，未启动 deepseek-harness 做实机验证。之后 P1 实施阶段已构建 AskTab 并执行真实 Chromium 扩展测试，具体范围见第 9 节。

可对照的参考项目现有测试：

- [process-groups.client.spec.ts](D:/dev/nodejs/deepseek-harness/packages/client/ui-chat/tests/process-groups.client.spec.ts:197)：prepend/append 身份保留、拆组、脏组刷新、首个回复关闭前组。
- [tool-preparation.client.spec.ts](D:/dev/nodejs/deepseek-harness/packages/client/ui-chat/tests/tool-preparation.client.spec.ts:90)：准备→调用→结果的稳定身份和历史差异。
- [chat-view.client.spec.tsx](D:/dev/nodejs/deepseek-harness/packages/client/ui-chat/tests/chat-view.client.spec.tsx:664)：模式切换不卸载、活跃与历史组滚动、整轮隐藏、steering 与焦点。
- [assistant-stream.client.spec.ts](D:/dev/nodejs/deepseek-harness/packages/api/session-controller/tests/assistant-stream.client.spec.ts:139)：transient 与持久 settlement 的衔接及重连。

实施时应迁移这些行为约束，并在 AskTab 的真实消息链上验证。无需引入参考项目的 Cordis 插件系统或复制整套 Session/Conversation 框架。

## 9. P1 交付记录（2026-10-02）

### 9.1 已实现的行为

- 相邻思考和工具合为过程组，组和内部详情默认收起；正文、图片、文档及独立消息保持原有顺序。
- 组头显示实时活动或结束类别摘要，支持英文、简体和繁体；例如「已完成分析」「已写入文件并读取文件」。类别由 AskTab 的真实工具决定。
- 组及单条开合不受增量内容、工具返回或组结束重置；隐藏时保留内部组件，长结果的展开全文和原始 JSON 视图继续可用。
- 缺状态、明确空值结果、独立结果、跳过和中断分别呈现；跳过不计为执行失败，未知历史不会永久转圈。
- 流式更新按活跃 assistant ID 定位；子代理卡片插入后仍更新正确消息。重试只重置对应消息的折叠状态，历史组不受影响。
- 没有修改消息协议、数据库结构、工具执行路径或模型上下文。

### 9.2 验证记录

- 变更前已在真实浏览器确认目标行为缺失：流式思考存在，但没有组级折叠按钮。
- 相关单元测试 70/70 通过，覆盖归一化、分组、标题、流式重试、快照、停止及 steering。
- 全项目 `pnpm type-check` 15/15 任务通过；完整构建和修复后的两个入口构建通过。
- 六个相关 Playwright 测试文件 30/30 通过，含本次新增的 8 个两入口用例；覆盖过程折叠、长结果、历史跳过结果、重试、后台恢复、队列/steering、Markdown、文档预览及消息编辑。420px 侧栏折叠图和全页展开图已人工检查。
- 修改的 TypeScript/TSX 文件 ESLint、全部变更文件 Prettier 及 `git diff --check` 通过。
- 独立只读审查发现并修正隐藏挂载导致长内容无法展开、独立跳过结果误报失败两项问题；复审未发现新的关键或重要问题。

### 9.3 明确保留的边界

- P2 的四档显示设置、组内跟随滚动、浏览器查找自动展开，以及 P3 的整轮折叠和持久化 run/step，尚未实施。
- 工具开始顺序由成员位置近似，没有伪造时间戳；组结束表示区间关闭，不代表工具成功。
- 重复 call ID 保留首次 call，结果支持原位更新及独立 tool-result 关联。若外部历史数据把更新后的结果仅嵌在第二条同 ID call 中，目前不会合并该条的新增事实；当前生产数据链不产生这种结构。
- 开合只保存在组件内存，刷新后恢复默认收起；其他语言的新摘要键按现有机制回退英文。
