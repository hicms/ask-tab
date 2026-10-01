import { markInterruptedToolCalls } from '../chat-cancellation.js';
import { MAX_QUEUED_MESSAGES } from '../chat-queue.js';
import { nanoid } from 'nanoid';
import { useState, useRef, useCallback, useEffect } from 'react';
import type {
  ChatQueueState,
  LLMQueueCommand,
  LLMQueueEditText,
  LLMQueueSnapshot,
  QueuedMessageMode,
} from '../chat-queue.js';
import type {
  Attachment,
  ChatMessage,
  ChatMessagePart,
  ChatModel,
  SessionUsage,
  StreamingStatus,
  LLMStreamChunk,
  LLMStreamEnd,
  LLMStreamError,
  LLMStreamSnapshot,
  ToolPartState,
} from '../chat-types.js';

interface UseLLMStreamOptions {
  chatId: string;
  initialMessages?: ChatMessage[];
  model: ChatModel;
  onStreamComplete?: (assistantMessage: ChatMessage, usage?: SessionUsage) => Promise<void> | void;
  onChatCreated?: (chatId: string, firstUserMessage: string) => void;
  onUserMessageCreated?: (userMessage: ChatMessage) => void;
  onTtsAudio?: (
    audioBase64: string,
    contentType: string,
    chunkIndex?: number,
    isLastChunk?: boolean,
  ) => void;
}

interface UseLLMStreamReturn {
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  sendMessage: (content: string, attachments?: Attachment[], replaceMessageId?: string) => void;
  status: StreamingStatus;
  stop: () => void;
  input: string;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  /** Messages waiting for the running turn, owned by the background. */
  queue: ChatQueueState;
  /** Returns false when the queue is full. */
  enqueue: (text: string, mode: QueuedMessageMode) => boolean;
  removeQueued: (itemId: string) => void;
  /** Returns the cleared state so it can be restored. */
  clearQueue: () => ChatQueueState;
  restoreQueue: (state: ChatQueueState) => void;
  steerQueued: (itemId: string) => void;
  resumeQueue: () => void;
  /** Moves a queued message into `input`, taking it out of the queue. */
  editQueued: (itemId: string) => void;
}

const EMPTY_MESSAGES: ChatMessage[] = [];
const EMPTY_QUEUE: ChatQueueState = { items: [] };

const useLLMStream = ({
  chatId,
  initialMessages = EMPTY_MESSAGES,
  model,
  onStreamComplete,
  onChatCreated,
  onUserMessageCreated,
  onTtsAudio,
}: UseLLMStreamOptions): UseLLMStreamReturn => {
  const [messages, setMessageState] = useState<ChatMessage[]>(initialMessages);
  const [status, setStatus] = useState<StreamingStatus>('idle');
  const [input, setInput] = useState('');

  const portRef = useRef<chrome.runtime.Port | null>(null);
  const abortedRef = useRef(false);
  const assistantMessageRef = useRef<ChatMessage | null>(null);
  const isFirstMessageRef = useRef(initialMessages.length === 0);
  const previousInitialMessagesRef = useRef(initialMessages);
  const messagesRef = useRef(initialMessages);
  const runningRef = useRef(false);
  const synchronizingRef = useRef(false);
  const pendingSendRef = useRef<{
    content: string;
    attachments?: Attachment[];
    replaceMessageId?: string;
  } | null>(null);
  const [queue, setQueueState] = useState<ChatQueueState>(EMPTY_QUEUE);
  const queueRef = useRef(EMPTY_QUEUE);

  // Update the ref synchronously: stream events can arrive before React renders.
  const setMessages = useCallback<React.Dispatch<React.SetStateAction<ChatMessage[]>>>(next => {
    const updated = typeof next === 'function' ? next(messagesRef.current) : next;
    messagesRef.current = updated;
    setMessageState(updated);
  }, []);

  // A persisted channel update refreshes messages without remounting the composer.
  // Consume each snapshot once, including snapshots skipped during a local stream,
  // so finishing that stream cannot replay an older database snapshot over its result.
  useEffect(() => {
    if (previousInitialMessagesRef.current === initialMessages) return;
    previousInitialMessagesRef.current = initialMessages;
    if (
      status === 'connecting' ||
      status === 'streaming' ||
      runningRef.current ||
      initialMessages.some(message => message.chatId !== chatId)
    ) {
      return;
    }
    setMessages(initialMessages);
    isFirstMessageRef.current = initialMessages.length === 0;
  }, [chatId, initialMessages, status, setMessages]);

  const updateAssistantPart = useCallback(
    (updater: (parts: ChatMessagePart[]) => ChatMessagePart[]) => {
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (!last || last.role !== 'assistant') return prev;
        const updated = { ...last, parts: updater([...last.parts]) };
        assistantMessageRef.current = updated;
        return [...prev.slice(0, -1), updated];
      });
    },
    [setMessages],
  );

  const handleChunk = useCallback(
    (chunk: LLMStreamChunk) => {
      if (abortedRef.current) return;

      if (chunk.delta) {
        updateAssistantPart(parts => {
          const lastPart = parts[parts.length - 1];
          if (lastPart && lastPart.type === 'text') {
            return [...parts.slice(0, -1), { ...lastPart, text: lastPart.text + chunk.delta }];
          }
          return [...parts, { type: 'text' as const, text: chunk.delta! }];
        });
        setStatus('streaming');
      }

      if (chunk.reasoning) {
        updateAssistantPart(parts => {
          const lastPart = parts[parts.length - 1];
          if (lastPart && lastPart.type === 'reasoning') {
            return [...parts.slice(0, -1), { ...lastPart, text: lastPart.text + chunk.reasoning }];
          }
          return [...parts, { type: 'reasoning' as const, text: chunk.reasoning! }];
        });
        setStatus('streaming');
      }

      if (chunk.toolCall) {
        updateAssistantPart(parts => {
          const existing = parts.find(
            p => p.type === 'tool-call' && p.toolCallId === chunk.toolCall!.id,
          );
          if (existing) {
            return parts.map(p =>
              p.type === 'tool-call' && p.toolCallId === chunk.toolCall!.id
                ? { ...p, state: chunk.state as ToolPartState, args: chunk.toolCall!.args }
                : p,
            );
          }
          return [
            ...parts,
            {
              type: 'tool-call' as const,
              toolCallId: chunk.toolCall!.id,
              toolName: chunk.toolCall!.name,
              args: chunk.toolCall!.args,
              state: chunk.state as ToolPartState,
            },
          ];
        });
      }

      if (chunk.toolResult) {
        updateAssistantPart(parts => {
          let updated = parts.map(p => {
            if (p.type === 'tool-call' && p.toolCallId === chunk.toolResult!.id) {
              return {
                ...p,
                result: chunk.toolResult!.result,
                state: (chunk.state ?? 'output-available') as ToolPartState,
              };
            }
            return p;
          });

          // Append image file parts from tool result (e.g. screenshots)
          if (chunk.toolResult!.files?.length) {
            const fileParts = chunk.toolResult!.files.map(f => ({
              type: 'file' as const,
              url: '',
              filename: f.filename,
              mediaType: f.mimeType,
              data: f.data,
            }));
            updated = [...updated, ...fileParts];
          }

          return updated;
        });
      }
    },
    [updateAssistantPart],
  );

  const handleEnd = useCallback(
    async (end: LLMStreamEnd) => {
      // Show timeout notice so the user knows the response was cut short
      if (end.finishReason === 'timeout') {
        updateAssistantPart(parts => [
          ...parts,
          { type: 'text' as const, text: '\n\n⚠️ Agent timed out — response may be incomplete.' },
        ]);
      }
      setStatus('idle');
      runningRef.current = false;
      // The port stays subscribed: the background may start the next queued turn.
      if (assistantMessageRef.current) {
        const usage = end.usage
          ? {
              ...end.usage,
              wasCompacted: end.wasCompacted,
              compactionMethod: end.compactionMethod,
              compactionTokensBefore: end.compactionTokensBefore,
              compactionTokensAfter: end.compactionTokensAfter,
              contextUsage: end.contextUsage,
              persistedByBackground: end.persistedByBackground,
            }
          : undefined;
        await onStreamComplete?.(assistantMessageRef.current, usage);
      }
    },
    [onStreamComplete, updateAssistantPart],
  );

  const handleError = useCallback(
    async (error: LLMStreamError) => {
      synchronizingRef.current = false;
      pendingSendRef.current = null;
      setStatus('error');
      runningRef.current = false;
      // Capture partial message before appending error text so persisted content is clean
      const partialMessage = assistantMessageRef.current;
      updateAssistantPart(parts => [
        ...parts,
        { type: 'text' as const, text: `\n\nError: ${error.error}` },
      ]);
      // Save partial assistant message on error so it's not lost on reload
      if (partialMessage && !error.persistedByBackground) {
        await onStreamComplete?.(partialMessage);
      }
    },
    [updateAssistantPart, onStreamComplete],
  );

  const handlersRef = useRef({ handleChunk, handleEnd, handleError, onTtsAudio });
  handlersRef.current = { handleChunk, handleEnd, handleError, onTtsAudio };

  const markStopped = useCallback(() => {
    synchronizingRef.current = false;
    pendingSendRef.current = null;
    runningRef.current = false;
    const assistantId = assistantMessageRef.current?.id;
    setMessages(previous =>
      previous.map(message =>
        message.id === assistantId
          ? { ...message, parts: markInterruptedToolCalls(message.parts) }
          : message,
      ),
    );
    setStatus('idle');
  }, [setMessages]);

  const connectPort = useCallback(() => {
    const previous = portRef.current;
    portRef.current = null;
    previous?.disconnect();
    const port = chrome.runtime.connect({ name: 'llm-stream' });
    portRef.current = port;
    port.onMessage.addListener((msg: Record<string, unknown>) => {
      if (portRef.current !== port || (msg.chatId && msg.chatId !== chatId)) return;
      const handlers = handlersRef.current;
      switch (msg.type) {
        case 'LLM_STREAM_SNAPSHOT': {
          const snapshot = msg as unknown as LLMStreamSnapshot;
          synchronizingRef.current = false;
          abortedRef.current = false;
          runningRef.current = snapshot.status === 'connecting' || snapshot.status === 'streaming';
          // A restored turn owns this session. Keep the shortcut as a draft,
          // without submitting it automatically when that turn finishes.
          if (runningRef.current) pendingSendRef.current = null;
          assistantMessageRef.current =
            snapshot.messages.find(m => m.id === snapshot.assistantMessageId) ?? null;
          isFirstMessageRef.current = snapshot.messages.length === 0;
          setMessages(snapshot.messages);
          setStatus(snapshot.status);
          break;
        }
        case 'LLM_STREAM_CHUNK':
          handlers.handleChunk(msg as unknown as LLMStreamChunk);
          break;
        case 'LLM_STREAM_END':
          void handlers.handleEnd(msg as unknown as LLMStreamEnd);
          break;
        case 'LLM_STREAM_ERROR':
          void handlers.handleError(msg as unknown as LLMStreamError);
          break;
        case 'LLM_STREAM_STOPPED':
          abortedRef.current = true;
          markStopped();
          break;
        case 'LLM_STREAM_RETRY':
          if (Number(msg.attempt) > 0) updateAssistantPart(() => []);
          break;
        case 'LLM_QUEUE_SNAPSHOT': {
          const { items, pauseReason } = msg as unknown as LLMQueueSnapshot;
          const next: ChatQueueState = pauseReason ? { items, pauseReason } : { items };
          queueRef.current = next;
          setQueueState(next);
          break;
        }
        case 'LLM_QUEUE_EDIT_TEXT': {
          const { text } = msg as unknown as LLMQueueEditText;
          // Keep whatever is already typed; the edited message follows it.
          setInput(previous => (previous.trim() ? `${previous.trimEnd()}\n${text}` : text));
          break;
        }
        case 'LLM_TTS_AUDIO':
          handlers.onTtsAudio?.(
            msg.audioBase64 as string,
            msg.contentType as string,
            msg.chunkIndex as number | undefined,
            msg.isLastChunk as boolean | undefined,
          );
          break;
      }
    });
    port.onDisconnect.addListener(() => {
      if (portRef.current !== port) return;
      portRef.current = null;
      synchronizingRef.current = false;
      pendingSendRef.current = null;
      if (runningRef.current) setStatus('error');
      runningRef.current = false;
      // Only a worker restart drops the port, and the restored queue waits for the user.
      const { items, pauseReason } = queueRef.current;
      if (items.length > 0) {
        const next: ChatQueueState = {
          items: items.map(item => ({ ...item, mode: 'queue' })),
          pauseReason: pauseReason ?? 'restarted',
        };
        queueRef.current = next;
        setQueueState(next);
      }
    });
    return port;
  }, [chatId, markStopped, setMessages, updateAssistantPart]);

  const sendMessage = useCallback(
    (content: string, attachments?: Attachment[], replaceMessageId?: string) => {
      if (synchronizingRef.current) {
        // Welcome cards are usable before the initial subscription replies.
        // Acknowledge the click and retain its intent instead of dropping it.
        pendingSendRef.current = { content, attachments, replaceMessageId };
        setInput(content);
        return;
      }
      if (runningRef.current) return;

      const editedIndex = replaceMessageId
        ? messagesRef.current.findIndex(m => m.id === replaceMessageId && m.role === 'user')
        : -1;
      if (replaceMessageId && editedIndex < 0) return;
      const editedMessage = editedIndex >= 0 ? messagesRef.current[editedIndex] : undefined;
      const history = editedMessage
        ? messagesRef.current.slice(0, editedIndex)
        : messagesRef.current;
      const userParts: ChatMessagePart[] = editedMessage
        ? editedMessage.parts.filter(part => part.type !== 'text')
        : [];

      // Add file parts first (for attachments)
      if (attachments?.length) {
        for (const att of attachments) {
          userParts.push({
            type: 'file',
            url: att.url,
            filename: att.name,
            mediaType: att.contentType,
            data: att.url, // data URL contains base64 content
          });
        }
      }

      // Add text part
      if (content) {
        userParts.push({ type: 'text', text: content });
      }

      const userMessage: ChatMessage = {
        id: editedMessage?.id ?? nanoid(),
        chatId,
        role: 'user',
        parts: userParts,
        createdAt: editedMessage?.createdAt ?? Date.now(),
      };

      const assistantMessage: ChatMessage = {
        id: nanoid(),
        chatId,
        role: 'assistant',
        parts: [],
        createdAt: Date.now(),
        model: model.id,
      };

      assistantMessageRef.current = assistantMessage;
      abortedRef.current = false;

      const newMessages = [...history, userMessage, assistantMessage];
      setMessages(newMessages);

      if (isFirstMessageRef.current) {
        isFirstMessageRef.current = false;
        onChatCreated?.(chatId, content);
      }

      // Persist user message to IndexedDB immediately (after chat is created for first msg)
      // Edits are committed by the background after the stopped turn finishes saving.
      if (!editedMessage) onUserMessageCreated?.(userMessage);

      // Open port and send request
      setStatus('connecting');
      runningRef.current = true;
      const port = connectPort();

      // Send the request with all messages except the empty assistant placeholder
      const messagesToSend = newMessages.filter(m => m !== assistantMessage);
      port.postMessage({
        type: 'LLM_REQUEST',
        chatId,
        messages: messagesToSend,
        model,
        assistantMessageId: assistantMessage.id,
        ...(replaceMessageId ? { replaceMessageId } : {}),
      });

      setInput('');
    },
    [chatId, model, connectPort, setMessages, onChatCreated, onUserMessageCreated],
  );

  const stop = useCallback(() => {
    abortedRef.current = true;
    // Between two queued turns there is no turn to name; stop whichever starts.
    portRef.current?.postMessage({
      type: 'LLM_STREAM_STOP',
      chatId,
      assistantMessageId: runningRef.current ? assistantMessageRef.current?.id : undefined,
    });
    markStopped();
  }, [chatId, markStopped]);

  /** A worker restart drops the port; reconnect on the next command rather than keep it awake. */
  const sendQueueCommand = useCallback(
    (command: LLMQueueCommand) => {
      let port = portRef.current;
      if (!port) {
        port = connectPort();
        port.postMessage({ type: 'LLM_STREAM_SUBSCRIBE', chatId });
      }
      port.postMessage(command);
    },
    [chatId, connectPort],
  );

  const enqueue = useCallback(
    (text: string, mode: QueuedMessageMode) => {
      if (queueRef.current.items.length >= MAX_QUEUED_MESSAGES) return false;
      sendQueueCommand({
        type: 'LLM_QUEUE_ADD',
        chatId,
        item: { id: nanoid(), text, mode, model, createdAt: Date.now() },
      });
      return true;
    },
    [chatId, model, sendQueueCommand],
  );

  const removeQueued = useCallback(
    (itemId: string) => sendQueueCommand({ type: 'LLM_QUEUE_REMOVE', chatId, itemId }),
    [chatId, sendQueueCommand],
  );

  const clearQueue = useCallback(() => {
    const cleared = queueRef.current;
    sendQueueCommand({ type: 'LLM_QUEUE_CLEAR', chatId });
    return cleared;
  }, [chatId, sendQueueCommand]);

  const restoreQueue = useCallback(
    ({ items, pauseReason }: ChatQueueState) =>
      sendQueueCommand({ type: 'LLM_QUEUE_RESTORE', chatId, items, pauseReason }),
    [chatId, sendQueueCommand],
  );

  const steerQueued = useCallback(
    (itemId: string) => sendQueueCommand({ type: 'LLM_QUEUE_STEER', chatId, itemId }),
    [chatId, sendQueueCommand],
  );

  const resumeQueue = useCallback(
    () => sendQueueCommand({ type: 'LLM_QUEUE_RESUME', chatId }),
    [chatId, sendQueueCommand],
  );

  const editQueued = useCallback(
    (itemId: string) => sendQueueCommand({ type: 'LLM_QUEUE_EDIT', chatId, itemId }),
    [chatId, sendQueueCommand],
  );

  useEffect(() => {
    if (synchronizingRef.current || status !== 'idle') return;
    const pending = pendingSendRef.current;
    pendingSendRef.current = null;
    // Editing or clearing the visible draft cancels the pending shortcut.
    if (pending && input === pending.content)
      sendMessage(pending.content, pending.attachments, pending.replaceMessageId);
  }, [input, status, sendMessage]);

  useEffect(() => {
    const port = connectPort();
    synchronizingRef.current = true;
    runningRef.current = true;
    setStatus('connecting');
    queueRef.current = EMPTY_QUEUE;
    setQueueState(EMPTY_QUEUE);
    port.postMessage({ type: 'LLM_STREAM_SUBSCRIBE', chatId });
    return () => {
      synchronizingRef.current = false;
      pendingSendRef.current = null;
      const current = portRef.current;
      portRef.current = null;
      current?.disconnect();
    };
  }, [chatId, connectPort]);

  return {
    messages,
    setMessages,
    sendMessage,
    status,
    stop,
    input,
    setInput,
    queue,
    enqueue,
    removeQueued,
    clearQueue,
    restoreQueue,
    steerQueued,
    resumeQueue,
    editQueued,
  };
};

export { useLLMStream };
