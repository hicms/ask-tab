import { DocumentPreview } from './document-preview';
import { MessageContent } from './elements/message';
import { Response } from './elements/response';
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from './elements/tool';
import { MessageActions } from './message-actions';
import { MessageEditor } from './message-editor';
import { MessageReasoning } from './message-reasoning';
import { PreviewAttachment } from './preview-attachment';
import { ToolResultView } from './tool-result-view';
import { isDocumentToolCall } from '../artifact-stream';
import { imageContentToSrc } from '../image-src';
import { getToolCategory, getToolIcon, summarizeToolCall } from '../tool-call-summary';
import { cn } from '../utils';
import { useState, useMemo, useCallback } from 'react';
import { toast } from 'sonner';
import type {
  ChatMessage,
  ChatMessagePart,
  StreamingStatus,
  ToolPartState,
} from '@extension/shared';

/** A run of consecutive tool-call parts rendered together as one step list. */
type ToolCallChatPart = Extract<ChatMessagePart, { type: 'tool-call' }>;
type RenderItem =
  | { kind: 'part'; part: ChatMessagePart; index: number }
  | { kind: 'tool-group'; parts: ToolCallChatPart[]; startIndex: number };

/** Groups consecutive non-document tool-call parts so they render as one compact step list
 *  instead of N separately-spaced cards. */
const buildRenderItems = (parts: ChatMessagePart[] | undefined): RenderItem[] => {
  const items: RenderItem[] = [];
  if (!parts) return items;
  let i = 0;
  while (i < parts.length) {
    const part = parts[i];
    if (part.type === 'tool-call' && !isDocumentToolCall(part)) {
      const startIndex = i;
      const group: ToolCallChatPart[] = [];
      while (i < parts.length) {
        const p = parts[i];
        if (p.type !== 'tool-call' || isDocumentToolCall(p)) break;
        group.push(p as ToolCallChatPart);
        i++;
      }
      items.push({ kind: 'tool-group', parts: group, startIndex });
      continue;
    }
    items.push({ kind: 'part', part, index: i });
    i++;
  }
  return items;
};

type PreviewMessageProps = {
  message: ChatMessage;
  isLoading: boolean;
  setMessages?: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  onEditSubmit?: (messageId: string, content: string) => void;
};

const AssistantAvatar = ({ isThinking = false }: { isThinking?: boolean }) => (
  <img
    alt="AskTab"
    className={cn('-mt-1 size-8 shrink-0', isThinking && 'animate-pulse')}
    src={chrome.runtime.getURL('asktab-avatar.svg')}
  />
);

const PreviewMessage = ({ message, isLoading, setMessages, onEditSubmit }: PreviewMessageProps) => {
  const [mode, setMode] = useState<'view' | 'edit'>('view');

  const textContent = useMemo(
    () =>
      message.parts
        ?.filter((p): p is Extract<ChatMessagePart, { type: 'text' }> => p.type === 'text')
        .map(p => p.text)
        .join('') ?? '',
    [message.parts],
  );

  // The connecting indicator already represents an assistant with no content yet.
  if (message.role === 'assistant' && message.parts.length === 0) {
    return null;
  }

  if (mode === 'edit' && message.role === 'user') {
    return (
      <div
        className="group/message fade-in animate-in w-full min-w-0 duration-200"
        data-role={message.role}
        data-testid={`message-${message.role}`}>
        <div className="flex w-full items-start justify-end gap-2 md:gap-3">
          <div className="max-w-[calc(100%-2.5rem)] sm:max-w-[min(fit-content,80%)]">
            <MessageEditor
              initialContent={textContent}
              onCancel={() => setMode('view')}
              onSend={content => {
                setMode('view');
                onEditSubmit?.(message.id, content);
              }}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="group/message fade-in animate-in w-full min-w-0 duration-200"
      data-role={message.role}
      data-testid={`message-${message.role}`}>
      <div
        className={cn('flex w-full min-w-0 items-start gap-2 md:gap-3', {
          'justify-end': message.role === 'user',
          'justify-start': message.role === 'assistant',
        })}>
        {message.role === 'assistant' && <AssistantAvatar />}

        <div
          className={cn('flex min-w-0 flex-col', {
            'gap-2 md:gap-4': message.parts?.some(
              p => p.type === 'text' && 'text' in p && p.text?.trim(),
            ),
            'w-full':
              message.role === 'assistant' &&
              (message.parts?.some(p => p.type === 'text' && 'text' in p && p.text?.trim()) ||
                message.parts?.some(p => p.type === 'tool-call')),
            'max-w-[calc(100%-2.5rem)] sm:max-w-[min(fit-content,80%)]': message.role === 'user',
          })}>
          {/* File attachments for user messages */}
          {message.role === 'user' &&
            (() => {
              const fileParts = message.parts?.filter(
                (p): p is Extract<ChatMessagePart, { type: 'file' }> => p.type === 'file',
              );
              if (!fileParts?.length) return null;
              return (
                <div className="flex justify-end gap-2" data-testid="message-attachments">
                  {fileParts.map((fp, i) => (
                    <PreviewAttachment
                      attachment={{
                        name: fp.filename ?? 'file',
                        url: fp.url,
                        contentType: fp.mediaType ?? '',
                      }}
                      key={`${message.id}-file-${i}`}
                    />
                  ))}
                </div>
              );
            })()}

          {buildRenderItems(message.parts).map(item => {
            if (item.kind === 'tool-group') {
              return (
                <div
                  className="my-1.5 flex w-full min-w-0 flex-col gap-0.5"
                  key={`message-${message.id}-tools-${item.startIndex}`}>
                  {item.parts.map(part => {
                    const state = (part.state ?? 'input-available') as ToolPartState;
                    return (
                      <ToolCallPart
                        args={part.args}
                        key={part.toolCallId}
                        result={part.result}
                        state={state}
                        toolName={part.toolName}
                      />
                    );
                  })}
                </div>
              );
            }

            const { part, index } = item;
            const key = `message-${message.id}-part-${index}`;

            if (part.type === 'reasoning') {
              const hasContent = part.text?.trim().length > 0;
              // Thinking is finished as soon as any other part follows it, not only when the
              // whole message stops streaming.
              const isThinking = isLoading && index === (message.parts?.length ?? 0) - 1;
              if (hasContent || isThinking) {
                return (
                  <MessageReasoning isLoading={isThinking} key={key} reasoning={part.text || ''} />
                );
              }
            }

            if (part.type === 'text') {
              return (
                <div key={key}>
                  <MessageContent
                    className={cn({
                      'wrap-break-word w-fit rounded-2xl px-3 py-2 text-right text-white':
                        message.role === 'user',
                      'bg-transparent px-0 py-0 text-left': message.role === 'assistant',
                    })}
                    data-testid="message-content"
                    style={message.role === 'user' ? { backgroundColor: '#006cff' } : undefined}>
                    <Response>{part.text}</Response>
                  </MessageContent>
                </div>
              );
            }

            if (part.type === 'file' && message.role !== 'user') {
              const isImage = part.mediaType?.startsWith('image/');
              if (isImage) {
                return (
                  <div className="my-1" key={key}>
                    <img
                      alt={part.filename ?? 'image'}
                      className="max-h-96 max-w-full rounded-lg object-contain"
                      src={imageContentToSrc(part.data ?? part.url)}
                    />
                  </div>
                );
              }
              return (
                <div className="text-muted-foreground my-1 text-sm" key={key}>
                  {part.filename ?? 'file'}
                </div>
              );
            }

            if (part.type === 'tool-call' && isDocumentToolCall(part)) {
              const result = part.result as
                | { id?: string; title?: string; kind?: string }
                | undefined;
              const args = part.args as { title?: string; kind?: string } | undefined;
              return (
                <div className="w-full" key={key}>
                  <DocumentPreview
                    args={
                      args
                        ? {
                            title: args.title ?? 'Untitled',
                            kind: (args.kind ?? 'text') as 'text' | 'code' | 'sheet' | 'image',
                          }
                        : undefined
                    }
                    result={
                      result?.id
                        ? {
                            id: result.id,
                            title: result.title ?? 'Untitled',
                            kind: (result.kind ?? 'text') as 'text' | 'code' | 'sheet' | 'image',
                          }
                        : undefined
                    }
                  />
                </div>
              );
            }

            return null;
          })}

          {/* Message actions (copy / edit) */}
          {!isLoading && textContent && (
            <MessageActions
              content={textContent}
              onEdit={
                message.role === 'user' && setMessages && onEditSubmit
                  ? () => setMode('edit')
                  : undefined
              }
              role={message.role}
            />
          )}
        </div>
      </div>
    </div>
  );
};

type ToolCallPartProps = {
  state: ToolPartState;
  toolName: string;
  args: Record<string, unknown>;
  result: unknown;
};

const ToolCallPart = ({ state, toolName, args, result }: ToolCallPartProps) => {
  const isComplete = state === 'output-available' || state === 'output-error';

  // Always collapsed by default — running state is conveyed by the one-line summary/icon in
  // the header, not by force-expanding the parameters/result panel. Users expand manually.
  const [open, setOpen] = useState(false);

  const handleCopy = useCallback(() => {
    const parts = [
      `Tool: ${toolName}`,
      `Parameters: ${JSON.stringify(args, null, 2)}`,
      result != null
        ? `Result: ${typeof result === 'string' ? result : JSON.stringify(result, null, 2)}`
        : null,
    ];
    navigator.clipboard.writeText(parts.filter(Boolean).join('\n\n')).then(() => {
      toast.success('Copied to clipboard');
    });
  }, [toolName, args, result]);

  const summary = summarizeToolCall(toolName, args, result, state);

  return (
    <Tool onOpenChange={setOpen} open={open}>
      <ToolHeader
        category={getToolCategory(toolName)}
        icon={getToolIcon(toolName)}
        name={toolName}
        onCopy={isComplete ? handleCopy : undefined}
        state={state}
        summary={summary}
      />
      <ToolContent>
        {state !== 'input-streaming' && <ToolInput input={args} />}

        {state === 'output-available' && result != null ? (
          <ToolOutput output={<ToolResultView args={args} result={result} toolName={toolName} />} />
        ) : null}

        {state === 'output-error' && result != null ? (
          <ToolOutput
            errorText={typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
            output={null}
          />
        ) : null}
      </ToolContent>
    </Tool>
  );
};

const ThinkingMessage = () => (
  <div
    className="group/message fade-in animate-in w-full duration-300"
    data-role="assistant"
    data-testid="message-assistant-loading">
    <div className="flex items-start justify-start gap-3">
      <AssistantAvatar isThinking />

      <div className="flex w-full flex-col gap-2 md:gap-4">
        <div className="text-muted-foreground flex items-center gap-1 p-0 text-sm">
          <span className="animate-pulse">Thinking</span>
          <span className="inline-flex">
            <span className="animate-bounce [animation-delay:0ms]">.</span>
            <span className="animate-bounce [animation-delay:150ms]">.</span>
            <span className="animate-bounce [animation-delay:300ms]">.</span>
          </span>
        </div>
      </div>
    </div>
  </div>
);

export { PreviewMessage, ThinkingMessage };
export type { PreviewMessageProps, StreamingStatus };
