# 推理中消息排队与引导对话 需求文档

> 状态：v0.3（已实施；与草案的差异见第 15 节）
> 范围：侧边栏（`pages/side-panel`）与全页聊天（`pages/full-page-chat`）的交互式聊天
> 关联代码：`packages/ui/lib/components/chat-input.tsx`、`packages/shared/lib/hooks/use-llm-stream.ts`、`chrome-extension/src/background/agents/stream-handler.ts`、`chrome-extension/src/background/agents/agent-setup.ts`、`chrome-extension/src/background/agents/agent.ts`、`chrome-extension/src/background/agents/agent-loop.ts`

---

## 1. 背景

目前模型推理（含工具调用）期间，输入框右下角的按钮固定为「停止」。用户在推理过程中想补充信息、纠正方向或预先写好下一个问题时，只能：

1. 等待本轮结束后再发送；或
2. 点击停止，丢掉正在进行的工作，再重新发送。

长任务（浏览器自动化、深度研究、子代理等）通常要运行几十秒到数分钟，这个限制明显影响体验。主流 AI 编程与对话产品（VS Code Copilot、Cursor、Codex CLI、Claude Code、pi coding agent）都已提供「排队发送」和「引导/插话」两类能力。

## 2. 目标

| 编号 | 目标 |
|------|------|
| G1 | 推理中按钮默认显示「停止」；输入框有内容时切换为「发送」，发送不打断当前推理。 |
| G2 | 推理中发送的消息进入**待发送队列**，显示在输入框上方，显示条数，支持删除单条和清空全部。 |
| G3 | 当前推理结束后，队列中的消息**按顺序依次自动发送**，每条消息独立成一轮对话。 |
| G4 | 用户可选择「**引导对话**」：消息插入到正在进行的这一轮对话中；如果有工具调用正在执行，等该工具执行完成后再插入。 |
| G5 | 所有新增文案支持中英文（`en`、`zh_CN`、`zh_TW`），其余语言回退英文。 |

## 3. 非目标（v1 不做）

- 队列消息携带附件（图片/文件）。v1 队列和引导只支持纯文本，推理中附件按钮保持禁用（与现状一致）。
- 在队列中拖拽排序、在托盘内直接编辑队列项（v2 考虑，见第 13 节）。v0.3 支持把队列项取回输入框编辑，见 R2.20。
- Telegram / WhatsApp 渠道、定时任务（cron）、心跳（heartbeat）、子代理的消息排队。它们不经过聊天输入框。
- 推理中执行斜杠命令（`/clear`、`/compact` 等）。推理中斜杠命令被拦截，见 7.6。
- 跨浏览器重启保留队列。见 9.2。

## 4. 术语

| 中文 | 英文（代码/文案） | 含义 |
|------|------------------|------|
| 一轮 / 运行 | run / turn | 一次 `LLM_REQUEST` 从开始到 `LLM_STREAM_END` / `ERROR` / `STOPPED` 的完整过程，可包含多次模型调用和多次工具调用。对应后台 `activeStreams` 中的一个 `ActiveStream`。 |
| 步骤 | step | 一轮中的一次模型调用及其后的工具执行，对应 agent-loop 的一个 `turn_start` … `turn_end`。 |
| 待发送队列 | queue | 当前轮结束后才发送的消息列表。语义等同 pi-agent-core 的 follow-up，但每条消息**单独开一轮**。 |
| 引导对话 | steer | 插入当前轮、让模型在下一步看到的用户消息。语义等同 pi-agent-core 的 steering。 |
| 暂停 | paused | 队列有内容但不会自动发送的状态（例如用户手动停止、上一轮出错后）。 |

## 5. 现状分析

### 5.1 输入框与按钮（`packages/ui/lib/components/chat-input.tsx`）

- `isStreaming = status === 'streaming' || status === 'connecting'`（约第 105 行）。
- 表单提交时，如果 `isStreaming` 就调用 `stop()`（约第 264 行）。也就是说，推理中按钮只有停止功能。
- `Enter` 键在推理中被忽略（约第 350–353 行判断 `!isStreaming`）。
- 按钮图标：推理中为 `SquareIcon`，否则为 `SendIcon`（约第 507 行）。**按钮没有 `aria-label`，也没有 tooltip。**
- 推理中附件按钮禁用（约第 440 行），麦克风按钮隐藏（`showMic = micEnabled && !isStreaming`，约第 110 行）。
- 输入历史 `useInputHistory` 仅在内存中。

### 5.2 前端流式 Hook（`packages/shared/lib/hooks/use-llm-stream.ts`）

- `sendMessage` 在 `runningRef.current` 为真时直接 `return`（约第 333 行），推理中的新消息会被静默丢弃。
- `pendingSendRef` 只用于「首次订阅完成前点击欢迎卡片」的场景，不是通用队列。
- `stop()` 发送 `LLM_STREAM_STOP` 并断开端口，然后 `markStopped()`。
- `handleEnd` 收到 `LLM_STREAM_END` 后会**断开端口**（`port?.disconnect()`）。这意味着如果后台在上一轮结束后自动开始下一轮，当前视图收不到广播。**实现队列时必须改为保持订阅，或结束后重新订阅。**
- 用户消息由前端创建并通过 `onUserMessageCreated` 持久化；助手消息由后台持久化（`persistedByBackground: true`）。

### 5.3 后台流处理（`chrome-extension/src/background/agents/stream-handler.ts`）

- `activeStreams: Map<chatId, ActiveStream>`，每个聊天同时最多一轮，与 UI 端口生命周期无关（关闭侧边栏不会停止推理）。
- 同一聊天的第二个视图（侧边栏 + 全页）通过 `LLM_STREAM_SNAPSHOT` 加入同一轮，不会打断。
- `stopLLMStream` 会校验 `assistantMessageId`，防止旧视图的延迟 Stop 取消新一轮。
- 新请求会 `await previous?.done`，等待被停止的旧一轮完成清理和持久化。
- 一轮只有**一个**助手消息 `active.assistantMessage`，所有文本、推理、工具调用都累积在它的 `parts` 里；结束时用 `finishModelTurn` 写入 UI 消息并锚定 `modelTranscripts`。
- `LLMRequestMessage` 只包含 `chatId`、`messages`、`model`、`assistantMessageId`、`tools`。后台如果要自己发起下一轮，需要自己构造这些字段（消息可从 IndexedDB 读取，模型需要随队列项保存）。

### 5.4 Agent 内核（`agent.ts` / `agent-loop.ts`）

项目内置的 `Agent` 类**已经具备** steering 与 follow-up 能力，只是没有被接入：

- `Agent.steer(m)` / `Agent.followUp(m)` 分别入队；`steeringMode` / `followUpMode` 默认 `'one-at-a-time'`。
- `runLoop` 的检查点：
  1. 循环开始时轮询一次 steering；
  2. **每个工具执行完成后**轮询 steering（`executeToolCalls` 内，工具是**串行**执行的）。如果有 steering 消息，同一条助手消息中**剩余未执行的工具调用会被跳过**，结果为错误文本 `Skipped due to queued user message.`；
  3. 每个步骤 `turn_end` 后轮询 steering；有则把消息加入上下文，继续下一次模型调用；
  4. 没有更多工具调用且没有 steering 时，轮询 follow-up；有则继续外层循环。
- 结论：「工具执行中插入引导，等工具完成后再插入」这一需求**与内核现有行为完全吻合**，不需要改循环本身。
- 限制：
  - `runAgent`（`agent-setup.ts`）每次尝试都 `new Agent(...)`，上下文溢出时最多重试 3 次（`MAX_RETRY_ATTEMPTS`），且不向调用方暴露 Agent 实例。需要增加注入钩子，并处理跨重试的 steering（见 8.3）。
  - 目前没有任何测试覆盖 steering 路径。
  - 默认超时 `DEFAULT_TIMEOUT_SECONDS` 为 600 秒，引导会延长单轮时长，需要考虑超时（见 7.4）。

### 5.5 其他相关现状与缺陷

| 位置 | 现状 | 对本需求的影响 |
|------|------|---------------|
| `docs/reference/keyboard-shortcuts.md` | 写着 `Escape` 可取消生成，但输入框没有对应处理 | 本需求新增 `Esc` 停止，顺带修复文档不符 |
| 历史消息编辑（`message-editor.tsx` / `message-actions.tsx`） | 推理中编辑历史用户消息会截断消息列表，随后 `sendMessage` 因 `runningRef` 直接返回，造成消息丢失 | 推理中禁用「编辑」「重新生成」 |
| `/compact` | 压缩期间 `isCompacting` 为真，按钮显示停止，但点击停止并不能取消压缩 | 压缩期间按钮应显示加载态并禁用，不接受入队 |
| 工具状态标签（`elements/tool.tsx`） | 状态文案硬编码英文；被跳过的工具显示为红色 Error | 新增「已跳过」状态与中英文文案 |
| `Chat` 组件 | 切换聊天时以 `chatKey` 重新挂载 | 队列状态不能只放在组件 state 里 |
| 会话列表 | `useRunningChats` 显示「推理中」 | 可选：显示队列条数 |

## 6. 业界参考

| 产品 | 排队 | 引导 | 默认 Enter | 其他 |
|------|------|------|-----------|------|
| VS Code Copilot Chat | Add to Queue | Steer with Message（在下一个工具调用边界插入） | 可配置 | 还有 Stop and Send；队列可拖拽排序 |
| Cursor | Enter 排队 | Ctrl/Cmd+Enter 立即发送，在下一个工具调用插入 | 排队 | Tab 也可排队 |
| Codex CLI | Tab 排到本轮结束 | Enter 在当前工具调用结束时插入 | 引导 | 引导消息在注入前显示为待处理 |
| Claude Code | 排队 | 排队消息会在任务中途被插入 | — | Issue #49373：用户抱怨队列在任务中途被冲掉，希望真正等到本轮结束 |
| pi coding agent | Alt+Enter follow-up | Enter steer | 引导 | Esc 中止并把队列消息还原到输入框；Alt+Up 取回；支持 one-at-a-time / all |

结论：

1. 「排队」和「引导」必须是两个明确区分的动作，用户能看出区别（Claude Code 的反面教训）。
2. 引导的插入点统一为「当前工具调用结束后」，业界一致。
3. 停止时队列不能被静默丢弃或自动发出。

## 7. 功能需求

### 7.1 输入框按钮状态机

| 编号 | 条件 | 主按钮 | 图标 | 可用 | `Enter` 行为 | tooltip / `aria-label` |
|------|------|--------|------|------|-------------|------------------------|
| S1 | 空闲，输入为空且无附件 | 发送 | `SendIcon` | 禁用 | 无 | `chat_send` |
| S2 | 空闲，有输入或附件 | 发送 | `SendIcon` | 可用 | 立即发送 | `chat_send` |
| S3 | 推理中（`connecting` / `streaming`），输入为空 | 停止 | `SquareIcon` | 可用 | 无 | `chat_stop` |
| S4 | 推理中，输入非空（`trim()` 后） | 发送（加入队列） | `SendIcon` + 下拉箭头 | 可用 | 加入队列 | `chat_addToQueue` |
| S5 | 附件上传中 | 维持当前图标 | — | 禁用 | 无 | — |
| S6 | `/compact` 压缩中 | 加载态 | Spinner | 禁用 | 无 | — |
| S7 | 空闲，队列已暂停且非空 | 同 S1 / S2 | — | — | 立即发送（不经过队列） | — |

要求：

- **R1.1** S3 与 S4 之间的切换只取决于 `input.trim()` 是否为空。清空输入后立即恢复为停止按钮。
- **R1.2** S4 的主按钮旁提供一个下拉菜单按钮（split button），菜单项依次为：
  - 「加入队列」（`chat_addToQueue`，快捷键提示 `Enter`）
  - 「引导对话」（`chat_steer`，快捷键提示 `Ctrl/Cmd + Enter`，副标题 `chat_steerHint`）
  - 「停止生成」（`chat_stop`，快捷键提示 `Esc`）。保证 S4 状态下仍能停止，不必先清空输入。
- **R1.3** 所有按钮必须有 `aria-label` 与 tooltip，文案走 i18n。
- **R1.4** 推理中按钮切换不应造成布局抖动（下拉箭头在 S3 时隐藏但保留宽度，或以动画过渡，交给设计定）。

### 7.2 待发送队列（Queue）

#### 入队

- **R2.1** 推理中（S4）按 `Enter` 或点击发送 / 选择「加入队列」：输入文本作为一条队列项追加到队尾，输入框清空并保持焦点。
- **R2.2** 入队文本记录到输入历史（`useInputHistory`），与正常发送一致。
- **R2.3** 队列上限 20 条。达到上限时不清空输入框，并提示 `chat_queueFull`。
- **R2.4** 入队时记录当前选择的模型（含思考级别），自动发送时使用该模型。
- **R2.5** 仅在推理中可以入队。空闲时发送永远是立即发送。

#### 队列托盘 UI

- **R2.6** 队列非空时，在输入框正上方显示「队列托盘」，与输入框视觉上连成一体（参考 Cursor / VS Code 的做法）。
- **R2.7** 托盘头部：左侧显示「待发送 N 条」（`chat_queueTitle`，`$1` 为条数）；右侧为「清空」按钮（`chat_queueClear`）。
- **R2.8** 每个队列项一行，从上到下与发送顺序一致：
  - 文本预览，最多两行，超出省略，悬停显示全文；
  - 状态标记：排队中（无标记）/ 引导中（`chat_queueSteering`，带小动画）；
  - 操作按钮（悬停或聚焦时显示，触屏设备常显）：「立即引导」（`chat_queueSteerItem`，仅当前有运行中的一轮时可用）、「编辑」（`chat_queueEdit`，见 R2.20）、「移除」（`chat_queueRemove`）。
- **R2.9** 托盘最多显示约 4 条的高度，超出后托盘内部滚动，不挤压消息列表。
- **R2.10** 托盘可折叠为一行摘要（P1，可选）。

#### 删除与清空

- **R2.11** 点击「移除」立即删除该项，无需确认。
- **R2.12** 点击「清空」立即删除所有排队中的项，并显示可撤销的 toast（复用 `archive_undo` 文案「撤销」），约 5 秒内可撤销。
- **R2.13** 已经进入「引导中」且已经被后台注入的消息不能再删除（它已经是对话的一部分）；「引导中」但尚未注入的项允许移除。
- **R2.14** 队列项被删光后托盘消失。

#### 编辑（v0.3）

- **R2.20** 点击「编辑」：该项离开队列（所有视图同步），文本放入发起视图的输入框，输入框获得焦点。排队中和尚未被取走的引导中项都可以编辑。
- **R2.21** 输入框已有草稿时不覆盖：取回的文本换行接在草稿之后。
- **R2.22** 取回的消息不会被自动发送，也不会作为引导注入。修改后重新提交与普通输入相同：排到队尾，或空闲时立即发送；使用提交时的模式和当前选择的模型。
- **R2.23** 后台只在该项仍在队列中时交出文本。已经发出或已被引导取走的项不交出，队列不变；发起视图已断开时该项保留在队列中。

#### 自动发送

- **R2.15** 当前一轮**正常结束**（收到 `LLM_STREAM_END`，含 `finishReason` 为 `stop` / `length`，且后台持久化完成）后，自动取出队首一条发送，开始新一轮。
- **R2.16** 每条队列项单独成一轮：一条用户消息 + 一条助手回复。不合并多条（`one-at-a-time`）。
- **R2.17** 新一轮结束后继续取下一条，直到队列为空。
- **R2.18** 自动发送的用户消息在消息列表中与手动发送的消息外观一致。
- **R2.19** 自动发送不依赖视图是否打开：关闭侧边栏、切换到其他聊天后，队列仍会在该聊天中按顺序执行完毕（由后台驱动，见第 8 节）。

### 7.3 引导对话（Steer）

#### 触发方式

- **R3.1** 推理中输入文本后：按 `Ctrl + Enter`（macOS 为 `Cmd + Enter`），或在发送下拉菜单中选择「引导对话」。
- **R3.2** 对已在队列中的项点击「立即引导」，把它从队列转为引导消息。
- **R3.3** 只有当前聊天有运行中的一轮时才能引导。没有运行中的一轮时，快捷键等同正常发送，菜单项不显示。

#### 插入时机

- **R3.4** 如果有工具正在执行：等**该工具执行完成**、结果返回后插入。不中断正在执行的工具。
- **R3.5** 如果模型正在生成文本或思考（没有工具在执行）：等当前这次模型输出结束后插入，然后模型基于新消息继续下一步。不截断正在输出的文本。
- **R3.6** 如果模型本次输出包含多个工具调用（串行执行），引导消息在当前工具完成后插入，**同一批次中剩余未执行的工具调用被跳过**（沿用内核行为，见决策 D2）。被跳过的工具在 UI 上显示为「已跳过」（`chat_toolSkipped`，灰色中性样式），而不是红色的错误。
- **R3.7** 如果同时有多条引导消息，按提交顺序每个检查点注入一条（`steeringMode: 'one-at-a-time'`）。
- **R3.8** 引导消息在注入前显示在队列托盘中，状态为「引导中」（`chat_queueSteering`：「等待当前步骤完成后插入」）。注入后从托盘移除，出现在消息列表中。
- **R3.9** 如果本轮在引导消息注入前就结束了（例如模型刚好输出完最终回答），这条引导消息**不能丢失**：它自动转为队首的队列项，并立即作为下一轮发送（优先于其他排队项）。

#### 展示

- **R3.10** 注入后，消息列表的展示为：

  ```text
  [用户] 原始问题
  [助手] 注入前的文本 / 工具调用（已完成、已跳过）
  [用户] 引导消息        ← 与普通用户消息外观一致（v0.2 取消了「引导」标记）
  [助手] 注入后的继续输出 ……
  ```

  即在注入点把当前助手消息**切分**为两条，中间插入一条真实的用户消息（见 8.4）。
- **R3.11** 刷新页面、重新打开侧边栏、在全页打开同一聊天后，展示结果一致。

### 7.4 停止、出错与超时

- **R4.1** 停止方式：S3 点击停止按钮；S4 在下拉菜单选择「停止生成」；输入框聚焦时按 `Esc`（如果斜杠菜单或其他弹层已打开，`Esc` 先关闭弹层）。
- **R4.2** 用户停止后：
  - 当前一轮中止（沿用现有逻辑，工具调用标记为中断）；
  - 尚未注入的引导消息转回普通队列项，放在队首；
  - 队列**暂停**，不自动发送。托盘头部显示 `chat_queuePausedStopped` 和「继续发送」（`chat_queueResume`）按钮；
  - 用户可以继续发送、移除、清空。
- **R4.3** 一轮以错误结束（`LLM_STREAM_ERROR`）后：队列暂停，显示 `chat_queuePausedError` 和「继续发送」按钮。
- **R4.4** 一轮以超时结束（`finishReason: 'timeout'`，后台视为正常结束）后：继续自动发送（见待决问题 Q3）。
- **R4.5** 点击「继续发送」后，立即发送队首一项，恢复自动发送。
- **R4.6** 队列暂停时，用户在输入框直接发送（S7）会立即发送该消息，队列保持暂停，不因此恢复。
- **R4.7** 上下文溢出触发的自动重试（`LLM_STREAM_RETRY`）期间，队列和引导的行为与正常推理一致，已注入的引导消息在重试中不能丢失（见 8.3）。

### 7.5 快捷键

| 快捷键 | 状态 | 行为 |
|--------|------|------|
| `Enter` | 空闲 | 发送（不变） |
| `Enter` | 推理中，输入非空 | 加入队列 |
| `Ctrl/Cmd + Enter` | 推理中，输入非空 | 引导对话 |
| `Ctrl/Cmd + Enter` | 空闲 | 发送（与 `Enter` 相同） |
| `Shift + Enter` | 任意 | 换行（不变） |
| `Esc` | 推理中，无弹层 | 停止生成 |
| `Esc` | 有斜杠菜单等弹层 | 关闭弹层（不停止） |

- 输入法组合中（`isComposing`）所有快捷键不生效，与现有逻辑一致。
- 需要同步更新 `docs/reference/keyboard-shortcuts.md`。
- 麦克风快捷键在推理中不会冲突，因为推理中麦克风按钮隐藏。

### 7.6 其他交互约束

- **R6.1 斜杠命令**：推理中斜杠命令菜单不弹出；如果提交的文本匹配已注册命令（如 `/clear`、`/compact`），不入队也不引导，提示 `chat_commandBlockedWhileRunning`，输入内容保留。
- **R6.2 编辑与重新生成**：推理中、以及队列正在自动发送期间，禁用历史消息的「编辑」和「重新生成」（修复 5.5 中的丢消息问题）。
- **R6.3 切换聊天 / 新建聊天**：队列绑定 `chatId`，切换到其他聊天不影响原聊天的队列。切回来时托盘恢复显示。
- **R6.4 多视图**：侧边栏和全页同时打开同一聊天时，两边看到同一份队列，任何一边的增删都实时同步。
- **R6.5 删除聊天**：清除该聊天的队列；如有运行中的一轮，按现有逻辑处理。
- **R6.6 归档聊天**：归档不影响队列（v0.2）。归档后打开的视图会切到新聊天，后台仍按原样执行完已排队的消息。
- **R6.7 备份恢复**：恢复全量备份后扩展会重新加载，`chrome.storage.session` 随之清空，所有聊天的队列一并清空。
- **R6.8 会话列表（P1）**：运行中的会话除「推理中」外，显示队列条数徽标（例如「+2」）。
- **R6.9 语音朗读（TTS）**：自动发送下一轮不必等上一轮的 TTS 播放完毕；但新一轮开始时是否打断上一轮的播放，沿用现有的新消息行为。

## 8. 技术方案建议

### 8.1 队列归属：放在后台（推荐）

队列放在后台的 `stream-handler.ts`（或新建 `chat-queue.ts`），按 `chatId` 维护，理由：

1. `Chat` 组件切换聊天时重新挂载，前端 state 会丢失；
2. 侧边栏关闭后推理仍在后台继续，队列需要在推理结束时由后台触发；
3. 多视图需要唯一的真相来源；
4. 引导消息必须由后台注入正在运行的 Agent。

备选方案「纯前端队列」实现简单，但关闭面板即丢失、多视图会重复发送，不推荐，仅在需要快速验证交互时作为原型。

### 8.2 数据模型

```ts
// packages/shared/lib/chat-types.ts
type QueuedMessageMode = 'queue' | 'steer';

interface QueuedChatMessage {
  id: string; // 注入或发送后直接用作用户消息 ID，便于去重
  chatId: string;
  text: string;
  mode: QueuedMessageMode;
  model: ChatModel; // 入队时选择的模型
  createdAt: number;
}

type ChatQueuePauseReason = 'stopped' | 'error' | 'restarted';

interface ChatQueueState {
  chatId: string;
  items: QueuedChatMessage[]; // 顺序即发送顺序；steer 项已交给 Agent 但未注入时仍保留在这里
  paused: boolean;
  pauseReason?: ChatQueuePauseReason;
}
```

### 8.3 端口协议

UI → 后台（通过现有 `llm-stream` 端口，或新增 `chat-queue` 端口）：

| 类型 | 字段 | 说明 |
|------|------|------|
| `LLM_QUEUE_ADD` | `chatId`, `item` | 入队；`mode: 'steer'` 时同时交给运行中的 Agent |
| `LLM_QUEUE_REMOVE` | `chatId`, `itemId` | 移除单项；已注入的项忽略 |
| `LLM_QUEUE_CLEAR` | `chatId` | 清空（不影响已注入的引导） |
| `LLM_QUEUE_RESTORE` | `chatId`, `items` | 撤销清空 |
| `LLM_QUEUE_STEER` | `chatId`, `itemId` | 队列项转为引导 |
| `LLM_QUEUE_RESUME` | `chatId` | 取消暂停并发送队首 |
| `LLM_QUEUE_EDIT` | `chatId`, `itemId` | 取回队列项编辑（v0.3）；项已不在队列时忽略 |

后台 → UI：

| 类型 | 字段 | 说明 |
|------|------|------|
| `LLM_QUEUE_SNAPSHOT` | `ChatQueueState` | 任何变化后广播；`LLM_STREAM_SUBSCRIBE` 时随流快照一起下发 |
| `LLM_QUEUE_EDIT_TEXT` | `chatId`, `text` | 只发给发起 `LLM_QUEUE_EDIT` 的视图；发送成功后后台才把该项移出队列（v0.3） |
| `LLM_STREAM_STEERED` | `chatId`, `finishedAssistantMessage`, `userMessage`, `assistantMessageId` | 引导消息已注入：前端定稿上一段助手消息，追加用户消息和新的助手占位 |
| `LLM_RUNNING_CHATS` | 增加 `queuedCounts?: Record<chatId, number>` | 会话列表徽标（P1） |

前端配套修改：

- `useLLMStream` 暴露 `enqueue(text, mode)`、`removeQueued(id)`、`clearQueue()`、`steerQueued(id)`、`resumeQueue()`、`editQueued(id)`（v0.3）和 `queue` 状态。
- `handleEnd` 不再断开端口，或在队列非空时立即重新 `LLM_STREAM_SUBSCRIBE`，确保能收到后台自动开始的下一轮的 `LLM_STREAM_SNAPSHOT`。
- 自动开始的新一轮对前端而言等同于「另一个视图发起的一轮」，走现有 snapshot 加入逻辑。

### 8.4 后台实现要点

**自动发送（queue）**

1. `handleLLMStream` 的 `finally` 在 `finish()` 之后检查该聊天的队列：非暂停、非空，且本轮以正常结束收尾时，取队首。
2. 后台构造 `LLMRequestMessage`：`messages` 从 IndexedDB 读取（`getMessagesByChatId`），追加新用户消息（`id = item.id`），`model = item.model`，新生成 `assistantMessageId`。
3. **后台负责持久化这条用户消息**（`addMessage` + `touchChat`），因为前端视图可能不存在。前端的 `onUserMessageCreated` 不能再重复写入（以消息 ID 去重）。
4. 调用 `handleLLMStream`（以虚拟 target / 无发起端口的方式），通过 `broadcast` 通知所有订阅者。

**引导（steer）**

1. `runAgent` / `executeAttempt` 新增选项，例如 `getSteeringMessages?: () => AgentMessage[]`，或 `onAgentCreated?: (agent) => void` 以便外部调用 `agent.steer()`。推荐前者：由 `ActiveStream` 持有一个引导缓冲区，Agent 的 `getSteeringMessages` 从缓冲区取，避免 Agent 实例在重试间更换导致消息丢失。
2. Agent 注入引导消息时会产生 `message_start` / `message_end`（`role: 'user'`）事件。`executeAttempt` 需要把它转发为新回调（例如 `onSteeringInjected(message)`）。
3. `runLLMStream` 收到该回调时：
   - 把当前 `assistantParts` 定稿为助手消息 A1，持久化（`addMessage`）；
   - 持久化引导用户消息 U2（`id = item.id`）；
   - 创建新的助手消息 A2，替换 `active.assistantMessage`，`active.request.messages` 追加 A1、U2（保证后加入的视图看到正确的快照）；
   - 重置 `assistantParts` 与 `turnPartStart`；
   - 广播 `LLM_STREAM_STEERED` 和 `LLM_QUEUE_SNAPSHOT`。
4. 轮结束时 `finishModelTurn` 以 A2 为锚点写入 `modelTranscripts`。模型侧历史中天然已经包含引导用户消息（Agent 上下文），需确认 `DbModelTranscript.lastUiMessageId` 与 `interruptedHistoryAsContext` 在「一轮对应多条 UI 消息」时行为正确。
5. `stopLLMStream` 的 `assistantMessageId` 校验要接受 A2 的 ID，前端 `assistantMessageRef` 在收到 `LLM_STREAM_STEERED` 后切换到 A2。
6. **重试**：上下文溢出重试会用原始 `history + prompt` 重新开始。已注入的引导消息必须带入重试（例如重试时把已注入的引导消息作为 prompt 之后的初始 steering 重新注入，或将其并入 prompt 数组），否则会静默丢失。
7. **轮结束兜底（R3.9）**：`agent_end` 之后缓冲区里仍有未注入的引导消息时，把它们转为队首的 `queue` 项，并跳过暂停判断直接发送。
8. **停止（R4.2）**：中止时把缓冲区中未注入的引导消息转回队首，设置 `paused: true, pauseReason: 'stopped'`。
9. **被跳过的工具**：`skipToolCall` 在 `details` 中加标记（如 `{ skipped: true }`），并透传到 UI 的工具部件；`elements/tool.tsx` 据此显示「已跳过」。保持 `ToolPartState` 类型不变，避免影响存储与适配器。
10. **超时**：引导会延长单轮。建议超时计时器在每次注入引导时不重置（防止无限延长），在待决问题 Q3 中确认。

### 8.5 持久化

- 队列状态写入 `chrome.storage.session`，key 例如 `chatQueue:<chatId>`，每次变更后写入，后台启动时读取。参考 `heartbeat/service/wake.ts` 的做法。
- `chrome.storage.session` 配额约 10 MB，扩展重载、更新、禁用或浏览器重启会清空。v1 纯文本、上限 20 条，容量足够；浏览器重启丢失队列可以接受（这些消息尚未发出）。
- Service Worker 重启：运行中的一轮已经丢失，队列从存储恢复后进入 `paused: true, pauseReason: 'restarted'`，不自动发送，托盘提示用户手动继续。
- 不修改 Dexie schema，不进入全量备份。

## 9. 国际化

新增 key 加到 `packages/i18n/locales/en/messages.json`（类型来源）和 `packages/i18n/locales/zh_CN/messages.json`，`zh_TW` 建议同步，其余语言回退英文。命名沿用 `<area>_<camelCase>` 约定。

| Key | en | zh_CN | 备注 |
|-----|----|-------|------|
| `chat_send` | Send | 发送 | 按钮 tooltip / aria |
| `chat_stop` | Stop generating | 停止生成 | |
| `chat_sendOptions` | More send options | 更多发送选项 | 下拉按钮 aria |
| `chat_addToQueue` | Add to queue | 加入队列 | |
| `chat_steer` | Steer conversation | 引导对话 | |
| `chat_steerHint` | Insert into the current reply after the running tool finishes | 在当前工具调用完成后插入本轮对话 | 菜单副标题 |
| `chat_queueTitle` | $1 queued | 待发送 $1 条 | `$1` 为条数 |
| `chat_queueClear` | Clear all | 清空 | |
| `chat_queueCleared` | Queue cleared | 已清空待发送队列 | toast，配合 `archive_undo` |
| `chat_queueRemove` | Remove | 移除 | |
| `chat_queueEdit` | Edit | 编辑 | v0.3，取回输入框编辑 |
| `chat_queueSteerItem` | Steer now | 立即引导 | |
| `chat_queueSteering` | Will be inserted after the current step | 等待当前步骤完成后插入 | 队列项状态 |
| `chat_queueResume` | Resume sending | 继续发送 | |
| `chat_queuePausedStopped` | Queue paused because generation was stopped | 已停止生成，队列已暂停 | |
| `chat_queuePausedError` | Queue paused because the last reply failed | 上一条回复出错，队列已暂停 | |
| `chat_queuePausedRestarted` | Queue paused after the extension restarted | 扩展已重启，队列已暂停 | |
| `chat_queueFull` | Queue is full (up to $1 messages) | 队列已满（最多 $1 条） | |
| `chat_queueNoAttachments` | Attachments can be sent after the reply finishes | 附件需要等回复结束后再发送 | 推理中带附件提交时提示 |
| `chat_toolSkipped` | Skipped | 已跳过 | 被引导打断的工具 |
| `chat_commandBlockedWhileRunning` | Commands are unavailable while a reply is being generated | 推理中无法执行命令 | |

可复用的现有 key：`common_cancel`、`common_delete`、`archive_undo`、`session_running`。

说明：`elements/tool.tsx` 中其余工具状态文案目前是硬编码英文，建议一并迁移到 i18n，但不作为本需求的验收项。

## 10. 无障碍

- 所有图标按钮有 `aria-label`（见第 9 节）。
- 队列托盘使用 `role="list"` / `role="listitem"`；条数变化通过 `aria-live="polite"` 播报（例如「待发送 2 条」）。
- 下拉菜单支持键盘上下选择、`Enter` 确认、`Esc` 关闭。
- 队列项操作按钮在键盘聚焦时可见。
- 「引导中」状态除动画外有文字说明，不只依赖颜色。

## 11. 验收标准

### 11.1 按钮与输入

- [ ] 推理中输入为空：按钮为停止，点击后停止生成。
- [ ] 推理中输入文字：按钮变为发送并带下拉菜单；删光文字后恢复为停止。
- [ ] 推理中按 `Esc`：停止生成；斜杠菜单打开时 `Esc` 只关闭菜单。
- [ ] 所有按钮有中英文 tooltip 和 `aria-label`。

### 11.2 队列

- [ ] 推理中按 `Enter` 发送 3 条：托盘显示「待发送 3 条」，顺序正确，输入框清空。
- [ ] 删除第 2 条后显示 2 条；点击清空后托盘消失，toast 撤销后恢复。
- [ ] 当前轮结束后，剩余消息按顺序各自成一轮自动发送，每条都有独立的助手回复。
- [ ] 自动发送过程中关闭侧边栏再打开：队列继续执行，界面显示正确的进行状态与剩余条数。
- [ ] 侧边栏和全页同时打开同一聊天：两边队列实时一致，不会重复发送。
- [ ] 切换到另一个聊天再切回：托盘内容保留。
- [ ] 第 21 条入队失败并提示，输入内容保留。
- [ ] 刷新后消息列表与自动发送时看到的一致，没有重复或缺失的用户消息。
- [ ] 点击队列项「编辑」：文本进入输入框（接在已有草稿后）并聚焦，该项离开托盘；当前轮结束后不发送、不注入该项；修改后重新提交排到队尾。

### 11.3 引导

- [ ] 工具执行中按 `Ctrl/Cmd + Enter`：托盘显示「引导中」；该工具完成后引导消息出现在消息列表中，模型随后的输出回应了引导内容。
- [ ] 模型一次调用了 3 个工具，在第 1 个执行时引导：第 1 个正常完成，第 2、3 个显示「已跳过」（灰色，非红色错误）。
- [ ] 模型纯文本输出中引导：文本不被截断，输出结束后插入引导消息并继续回答。
- [ ] 模型刚好输出完最终回答时引导：引导消息作为下一轮立即发送，不丢失。
- [ ] 对队列项点击「立即引导」：效果与直接引导相同。
- [ ] 引导后刷新、换视图打开：消息顺序为「用户 → 助手（前半段）→ 用户（引导）→ 助手（后半段）」。
- [ ] 引导后发生上下文溢出重试：重试后的上下文仍包含引导消息。

### 11.4 停止与异常

- [ ] 有队列时停止：当前轮中止；未注入的引导消息回到队首；托盘显示暂停提示和「继续发送」；不自动发送。
- [ ] 点击「继续发送」：立即发送队首并恢复自动发送。
- [ ] 当前轮出错：队列暂停并提示。
- [ ] Service Worker 重启后：队列保留并处于暂停状态。
- [ ] 推理中输入 `/clear` 提交：被拦截并提示，不入队。
- [ ] 推理中历史消息的「编辑」「重新生成」不可用。

## 12. 测试计划

| 层级 | 文件 | 覆盖内容 |
|------|------|---------|
| 单元 | `chrome-extension/src/background/agents/agent-loop.test.ts` | 工具执行后注入 steering、跳过剩余工具、纯文本步骤后注入、`one-at-a-time`（当前无覆盖，需要补） |
| 单元 | `chrome-extension/src/background/agents/stream-handler.test.ts` | 自动发送顺序、暂停/恢复、停止时引导回退、轮结束兜底、消息切分与持久化、`assistantMessageId` 校验 |
| 单元 | 新增 `chat-queue.test.ts` | 队列增删清空、上限、`chrome.storage.session` 读写与重启恢复 |
| 单元 | `packages/shared/lib/hooks/use-llm-stream.test.ts` | `LLM_QUEUE_SNAPSHOT` / `LLM_STREAM_STEERED` 处理、结束后保持订阅 |
| 组件 | `chat-input` 相关测试 | 按钮状态机 S1–S7、快捷键、`isComposing` |
| E2E | 基于 `tests/playwright/e2e/background-chat-stream.spec.ts` 的可控流 mock | 11.2–11.4 的主要场景，包括关闭再打开面板、双视图 |

## 13. 分期

| 阶段 | 内容 |
|------|------|
| P0（本需求） | 按钮状态机、队列托盘（删除/清空）、自动发送、引导（快捷键 + 下拉菜单 + 立即引导）、停止/出错暂停、`Esc` 停止、中英文文案、推理中禁用编辑与斜杠命令 |
| P1 | 清空撤销 toast、会话列表队列徽标、托盘折叠、「停止并发送」、工具状态文案 i18n |
| P2 | 托盘内联编辑与拖拽排序、队列支持附件、`Alt + Up` 取回最后一条队列项到输入框、可配置默认 `Enter` 行为（排队 / 引导） |

## 14. 设计决策与待决问题

以下决策文档中已给出默认方案，评审时请确认。

| 编号 | 问题 | 默认方案 | 备选 |
|------|------|---------|------|
| D1 | 推理中 `Enter` 的默认动作 | 加入队列（与需求描述、Cursor 一致；排队对当前工作无副作用） | 引导（Codex、pi 的默认）；或做成设置项（P2） |
| D2 | 引导时同一批次剩余工具是否执行 | 跳过（内核现有行为，响应更快，模型会重新规划） | 等整批工具执行完再注入，需要修改 `executeToolCalls` |
| D3 | 停止后如何处理队列 | 暂停并保留，由用户点击「继续发送」 | 把队列内容全部还原到输入框（pi 做法）；或继续自动发送 |
| D4 | 多条排队消息的发送方式 | 每条单独成一轮 | 合并为一条消息发送（`all` 模式） |
| D5 | 引导消息在 UI 中的表示 | 切分助手消息，插入真实用户消息 | 在助手消息内新增 `user-steer` 部件类型（改动存储与适配器更多） |
| D6 | 队列持久化位置 | `chrome.storage.session` | IndexedDB（需要升级 Dexie schema，可跨浏览器重启） |

待决问题：

- **Q1** 自动发送时使用入队时的模型，还是发送时输入框当前选择的模型？默认入队时的模型。如果用户在推理中切换了模型，是否需要提示？
- **Q2** 队列自动执行期间，用户在另一个聊天中发起新对话，两个聊天并行运行是否有资源或配额问题？目前后台允许不同聊天并行，默认不做限制。
- **Q3** 超时（`finishReason: 'timeout'`）后是否继续自动发送？引导是否延长超时？默认继续发送、不延长。
- **Q4** 引导消息是否需要附加系统提示（例如「用户在你执行任务时补充了以下信息」），帮助模型理解上下文？默认不加，原样作为用户消息注入。
- **Q5** 心跳（heartbeat）或其他后台任务也在同一聊天中运行时，队列与它们的先后关系如何？需要确认心跳是否复用交互式聊天的 `chatId`。

## 15. 实施说明（v0.2）

实现与草案的差异如下，以代码为准。

| 位置 | 草案 | 实现 |
|------|------|------|
| 8.2 数据模型 | `QueuedChatMessage` 含 `chatId`，`ChatQueueState` 含 `paused` | 类型在 `packages/shared/lib/chat-queue.ts`。队列项不含 `chatId`（由所属队列决定）；暂停只由 `pauseReason` 表示，空队列永不暂停 |
| 8.3 端口协议 | 新增 `LLM_STREAM_STEERED` | 不新增消息。引导注入时后台重新广播 `LLM_STREAM_SNAPSHOT`，前端按「加入已有一轮」的逻辑处理 |
| 8.3 `LLM_QUEUE_RESTORE` | `chatId`, `items` | 另带可选 `pauseReason`，撤销清空后恢复原来的暂停状态 |
| 8.4 引导钩子 | `getSteeringMessages` 或 `onAgentCreated` | `runAgent` 新增 `getSteeringMessages` 与 `onUserMessage`。`Agent` 先取内部 `steer()` 队列，为空时再取外部来源。每次重试会重放已注入和已取出的引导消息，已定稿的前几段助手消息保留，按用户消息 ID 去重 |
| R3.10 展示 | 引导消息带 `chat_steeredBadge` 标记 | 取消标记，引导消息与普通用户消息外观一致 |
| R6.6 归档 | 队列暂停并保留 | 归档不影响队列 |
| R6.7 备份恢复 | 清空所有队列 | 恢复后扩展重新加载，`chrome.storage.session` 清空，队列随之清空，无需额外处理 |
| 附件 | 推理中附件按钮禁用 | 同草案。若附件在推理开始前已添加，推理中提交会提示 `chat_queueNoAttachments` 并保留草稿 |
| 两轮之间 | 未定义 | 队列未暂停且非空时（即将自动开始下一轮），输入框同样处于「推理中」状态：`Enter` 入队，停止按钮暂停队列 |
| P1 | 会话列表队列徽标、托盘折叠、「停止并发送」 | 未实现。清空撤销 toast 已实现 |
| 编辑队列项 | P2 | v0.3 实现为取回到输入框编辑（R2.20–R2.23），不提供托盘内联编辑 |

待决问题采用默认方案：Q1 使用入队时的模型；Q3 超时视为正常结束并继续发送，引导不延长超时；Q4 引导消息原样注入。
