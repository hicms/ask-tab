/**
 * Agent class — local wrapper that uses the local agent-loop.ts (with
 * AskTab error guard) instead of the npm version.
 */

import { agentLoop, agentLoopContinue } from './agent-loop';
import { releaseToolResources } from '../tools/tool-lifecycle';
import type {
  AgentContext,
  AgentEvent,
  AgentLoopConfig,
  AgentMessage,
  AgentState,
  AgentTool,
  StreamFn,
  ThinkingLevel,
} from '@mariozechner/pi-agent-core';
import type {
  Api,
  ImageContent,
  Message,
  Model,
  TextContent,
  ThinkingBudgets,
} from '@mariozechner/pi-ai';

const defaultConvertToLlm = (messages: AgentMessage[]): Message[] =>
  messages.filter(m => m.role === 'user' || m.role === 'assistant' || m.role === 'toolResult');

export interface AgentOptions {
  initialState?: Partial<AgentState>;
  convertToLlm?: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;
  transformContext?: (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>;
  steeringMode?: 'all' | 'one-at-a-time';
  followUpMode?: 'all' | 'one-at-a-time';
  streamFn?: StreamFn;
  sessionId?: string;
  getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
  thinkingBudgets?: ThinkingBudgets;
  maxRetryDelayMs?: number;
  onCheckpoint?: (messages: AgentMessage[]) => Promise<void>;
  /** Steering messages owned outside the agent; polled whenever the steer() queue is empty. */
  getSteeringMessages?: () => Promise<AgentMessage[]>;
}

export class Agent {
  private _state: AgentState;

  private listeners = new Set<(e: AgentEvent) => void>();
  private abortController?: AbortController;
  private convertToLlm: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;
  private transformContext?: (
    messages: AgentMessage[],
    signal?: AbortSignal,
  ) => Promise<AgentMessage[]>;
  private steeringQueue: AgentMessage[] = [];
  private followUpQueue: AgentMessage[] = [];
  private steeringMode: 'all' | 'one-at-a-time';
  private followUpMode: 'all' | 'one-at-a-time';
  public streamFn?: StreamFn;
  private _sessionId?: string;
  public getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
  private runningPrompt?: Promise<void>;
  private resolveRunningPrompt?: () => void;
  private _thinkingBudgets?: ThinkingBudgets;
  private _maxRetryDelayMs?: number;
  private onCheckpoint?: AgentOptions['onCheckpoint'];
  private externalSteering?: AgentOptions['getSteeringMessages'];

  constructor(opts: AgentOptions = {}) {
    this._state = {
      systemPrompt: '',
      model: undefined as unknown as Model<Api>, // Must be set via initialState or setModel
      thinkingLevel: 'off',
      tools: [],
      messages: [],
      isStreaming: false,
      streamMessage: null,
      pendingToolCalls: new Set<string>(),
      error: undefined,
      ...opts.initialState,
    };
    this.convertToLlm = opts.convertToLlm || defaultConvertToLlm;
    this.transformContext = opts.transformContext;
    this.steeringMode = opts.steeringMode || 'one-at-a-time';
    this.followUpMode = opts.followUpMode || 'one-at-a-time';
    this.streamFn = opts.streamFn;
    this._sessionId = opts.sessionId;
    this.getApiKey = opts.getApiKey;
    this._thinkingBudgets = opts.thinkingBudgets;
    this._maxRetryDelayMs = opts.maxRetryDelayMs;
    this.onCheckpoint = opts.onCheckpoint;
    this.externalSteering = opts.getSteeringMessages;
  }

  get sessionId(): string | undefined {
    return this._sessionId;
  }

  set sessionId(value: string | undefined) {
    this._sessionId = value;
  }

  get thinkingBudgets(): ThinkingBudgets | undefined {
    return this._thinkingBudgets;
  }

  set thinkingBudgets(value: ThinkingBudgets | undefined) {
    this._thinkingBudgets = value;
  }

  get maxRetryDelayMs(): number | undefined {
    return this._maxRetryDelayMs;
  }

  set maxRetryDelayMs(value: number | undefined) {
    this._maxRetryDelayMs = value;
  }

  get state(): AgentState {
    return this._state;
  }

  subscribe(fn: (e: AgentEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  setSystemPrompt(v: string) {
    this._state.systemPrompt = v;
  }

  setModel(m: Model<Api>) {
    this._state.model = m;
  }

  setThinkingLevel(l: ThinkingLevel) {
    this._state.thinkingLevel = l;
  }

  setTools(t: AgentTool[]) {
    this._state.tools = t;
  }

  replaceMessages(ms: AgentMessage[]) {
    this._state.messages = ms.slice();
  }

  appendMessage(m: AgentMessage) {
    this._state.messages = [...this._state.messages, m];
  }

  steer(m: AgentMessage) {
    this.steeringQueue.push(m);
  }

  followUp(m: AgentMessage) {
    this.followUpQueue.push(m);
  }

  clearSteeringQueue() {
    this.steeringQueue = [];
  }

  clearFollowUpQueue() {
    this.followUpQueue = [];
  }

  clearAllQueues() {
    this.steeringQueue = [];
    this.followUpQueue = [];
  }

  hasQueuedMessages(): boolean {
    return this.steeringQueue.length > 0 || this.followUpQueue.length > 0;
  }

  private dequeueSteeringMessages(): AgentMessage[] {
    if (this.steeringMode === 'one-at-a-time') {
      if (this.steeringQueue.length > 0) {
        const first = this.steeringQueue[0];
        this.steeringQueue = this.steeringQueue.slice(1);
        return [first];
      }
      return [];
    }

    const steering = this.steeringQueue.slice();
    this.steeringQueue = [];
    return steering;
  }

  private dequeueFollowUpMessages(): AgentMessage[] {
    if (this.followUpMode === 'one-at-a-time') {
      if (this.followUpQueue.length > 0) {
        const first = this.followUpQueue[0];
        this.followUpQueue = this.followUpQueue.slice(1);
        return [first];
      }
      return [];
    }

    const followUp = this.followUpQueue.slice();
    this.followUpQueue = [];
    return followUp;
  }

  clearMessages() {
    this._state.messages = [];
  }

  abort() {
    this.abortController?.abort();
  }

  waitForIdle(): Promise<void> {
    return this.runningPrompt ?? Promise.resolve();
  }

  reset() {
    this._state.messages = [];
    this._state.isStreaming = false;
    this._state.streamMessage = null;
    this._state.pendingToolCalls = new Set<string>();
    this._state.error = undefined;
    this.steeringQueue = [];
    this.followUpQueue = [];
  }

  async prompt(message: AgentMessage | AgentMessage[]): Promise<void>;
  async prompt(input: string, images?: ImageContent[]): Promise<void>;
  async prompt(input: string | AgentMessage | AgentMessage[], images?: ImageContent[]) {
    if (this._state.isStreaming) {
      throw new Error(
        'Agent is already processing a prompt. Use steer() or followUp() to queue messages, or wait for completion.',
      );
    }

    const model = this._state.model;
    if (!model) throw new Error('No model configured');

    let msgs: AgentMessage[];

    if (Array.isArray(input)) {
      msgs = input;
    } else if (typeof input === 'string') {
      const content: Array<TextContent | ImageContent> = [{ type: 'text', text: input }];
      if (images && images.length > 0) {
        content.push(...images);
      }
      msgs = [
        {
          role: 'user',
          content,
          timestamp: Date.now(),
        },
      ];
    } else {
      msgs = [input];
    }

    await this._runLoop(msgs);
  }

  async continue() {
    if (this._state.isStreaming) {
      throw new Error('Agent is already processing. Wait for completion before continuing.');
    }

    const messages = this._state.messages;
    if (messages.length === 0) {
      throw new Error('No messages to continue from');
    }
    if (messages[messages.length - 1].role === 'assistant') {
      const queuedSteering = this.dequeueSteeringMessages();
      if (queuedSteering.length > 0) {
        await this._runLoop(queuedSteering, { skipInitialSteeringPoll: true });
        return;
      }

      const queuedFollowUp = this.dequeueFollowUpMessages();
      if (queuedFollowUp.length > 0) {
        await this._runLoop(queuedFollowUp);
        return;
      }

      throw new Error('Cannot continue from message role: assistant');
    }

    await this._runLoop(undefined);
  }

  private async _runLoop(
    messages?: AgentMessage[],
    options?: { skipInitialSteeringPoll?: boolean },
  ) {
    const model = this._state.model;
    if (!model) throw new Error('No model configured');

    this.runningPrompt = new Promise<void>(resolve => {
      this.resolveRunningPrompt = resolve;
    });

    const controller = new AbortController();
    this.abortController = controller;
    this._state.isStreaming = true;
    this._state.streamMessage = null;
    this._state.error = undefined;

    const reasoning = this._state.thinkingLevel === 'off' ? undefined : this._state.thinkingLevel;

    const context: AgentContext = {
      systemPrompt: this._state.systemPrompt,
      messages: this._state.messages.slice(),
      tools: this._state.tools,
    };

    let skipInitialSteeringPoll = options?.skipInitialSteeringPoll === true;

    const config: AgentLoopConfig & Pick<AgentOptions, 'onCheckpoint'> = {
      model,
      reasoning,
      sessionId: this._sessionId,
      thinkingBudgets: this._thinkingBudgets,
      maxRetryDelayMs: this._maxRetryDelayMs,
      convertToLlm: this.convertToLlm,
      onCheckpoint: this.onCheckpoint,
      transformContext: this.transformContext,
      getApiKey: this.getApiKey,
      getSteeringMessages: async () => {
        if (skipInitialSteeringPoll) {
          skipInitialSteeringPoll = false;
          return [];
        }
        const queued = this.dequeueSteeringMessages();
        if (queued.length > 0 || !this.externalSteering) return queued;
        return this.externalSteering();
      },
      getFollowUpMessages: async () => this.dequeueFollowUpMessages(),
    };

    let partial: AgentMessage | null = null;
    let endEvent: Extract<AgentEvent, { type: 'agent_end' }> | undefined;

    try {
      const stream = messages
        ? agentLoop(messages, context, config, controller.signal, this.streamFn)
        : agentLoopContinue(context, config, controller.signal, this.streamFn);

      for await (const event of stream) {
        switch (event.type) {
          case 'message_start':
            partial = event.message;
            this._state.streamMessage = event.message;
            break;

          case 'message_update':
            partial = event.message;
            this._state.streamMessage = event.message;
            break;

          case 'message_end':
            partial = null;
            this._state.streamMessage = null;
            this.appendMessage(event.message);
            break;

          case 'tool_execution_start': {
            const s = new Set(this._state.pendingToolCalls);
            s.add(event.toolCallId);
            this._state.pendingToolCalls = s;
            break;
          }

          case 'tool_execution_end': {
            const s = new Set(this._state.pendingToolCalls);
            s.delete(event.toolCallId);
            this._state.pendingToolCalls = s;
            break;
          }

          case 'turn_end':
            if (event.message.role === 'assistant' && event.message.errorMessage) {
              this._state.error = event.message.errorMessage;
            }
            break;

          case 'agent_end':
            endEvent = event;
            continue;
        }

        this.emit(event);
      }

      if (partial && partial.role === 'assistant' && partial.content.length > 0) {
        const onlyEmpty = !partial.content.some(
          c =>
            (c.type === 'thinking' && c.thinking.trim().length > 0) ||
            (c.type === 'text' && c.text.trim().length > 0) ||
            (c.type === 'toolCall' && c.name.trim().length > 0),
        );
        if (!onlyEmpty) {
          this.appendMessage(partial);
        } else {
          if (this.abortController?.signal.aborted) {
            throw new Error('Request was aborted');
          }
        }
      }
    } catch (err) {
      const message = (err as { message?: string } | null | undefined)?.message || String(err);
      const errorMsg: AgentMessage = {
        role: 'assistant',
        content: [{ type: 'text', text: '' }],
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: this.abortController?.signal.aborted ? 'aborted' : 'error',
        errorMessage: message,
        timestamp: Date.now(),
      } as AgentMessage;

      this.appendMessage(errorMsg);
      this._state.error = message;
      endEvent = { type: 'agent_end', messages: [errorMsg] };
    } finally {
      await releaseToolResources(controller.signal);
      this._state.isStreaming = false;
      this._state.streamMessage = null;
      this._state.pendingToolCalls = new Set<string>();
      this.abortController = undefined;
      this.resolveRunningPrompt?.();
      this.runningPrompt = undefined;
      this.resolveRunningPrompt = undefined;
      if (endEvent) this.emit(endEvent);
    }
  }

  private emit(e: AgentEvent) {
    for (const listener of this.listeners) {
      listener(e);
    }
  }
}
