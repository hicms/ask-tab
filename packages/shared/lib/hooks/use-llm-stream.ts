import { markInterruptedToolCalls } from '../chat-cancellation.js';
import { nanoid } from 'nanoid';
import { useState, useRef, useCallback, useEffect } from 'react';
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
  sendMessage: (content: string, attachments?: Attachment[]) => void;
  status: StreamingStatus;
  stop: () => void;
  input: string;
  setInput: React.Dispatch<React.SetStateAction<string>>;
}

const EMPTY_MESSAGES: ChatMessage[] = [];

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
      const port = portRef.current;
      portRef.current = null;
      port?.disconnect();
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
      setStatus('error');
      runningRef.current = false;
      // Capture partial message before appending error text so persisted content is clean
      const partialMessage = assistantMessageRef.current;
      updateAssistantPart(parts => [
        ...parts,
        { type: 'text' as const, text: `\n\nError: ${error.error}` },
      ]);
      const port = portRef.current;
      portRef.current = null;
      port?.disconnect();
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
          abortedRef.current = false;
          runningRef.current = snapshot.status === 'connecting' || snapshot.status === 'streaming';
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
      if (runningRef.current) setStatus('error');
      runningRef.current = false;
    });
    return port;
  }, [chatId, markStopped, setMessages, updateAssistantPart]);

  const sendMessage = useCallback(
    (content: string, attachments?: Attachment[]) => {
      if (runningRef.current) return;

      const userParts: ChatMessagePart[] = [];

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
        id: nanoid(),
        chatId,
        role: 'user',
        parts: userParts,
        createdAt: Date.now(),
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

      const newMessages = [...messagesRef.current, userMessage, assistantMessage];
      setMessages(newMessages);

      if (isFirstMessageRef.current) {
        isFirstMessageRef.current = false;
        onChatCreated?.(chatId, content);
      }

      // Persist user message to IndexedDB immediately (after chat is created for first msg)
      onUserMessageCreated?.(userMessage);

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
      });

      setInput('');
    },
    [chatId, model, connectPort, setMessages, onChatCreated, onUserMessageCreated],
  );

  const stop = useCallback(() => {
    abortedRef.current = true;
    const port = portRef.current;
    portRef.current = null;
    port?.postMessage({
      type: 'LLM_STREAM_STOP',
      chatId,
      assistantMessageId: assistantMessageRef.current?.id,
    });
    port?.disconnect();
    markStopped();
  }, [chatId, markStopped]);

  useEffect(() => {
    const port = connectPort();
    runningRef.current = true;
    setStatus('connecting');
    port.postMessage({ type: 'LLM_STREAM_SUBSCRIBE', chatId });
    return () => {
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
  };
};

export { useLLMStream };
