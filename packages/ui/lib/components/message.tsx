import { DocumentPreview } from './document-preview';
import { MessageContent } from './elements/message';
import { Response, UserResponse } from './elements/response';
import { MessageActions } from './message-actions';
import { MessageEditor } from './message-editor';
import { MessageReasoning } from './message-reasoning';
import { PreviewAttachment } from './preview-attachment';
import { ProcessGroup } from './process-group';
import { isDocumentToolCall } from '../artifact-stream';
import { imageContentToSrc } from '../image-src';
import { buildProcessGroups } from '../process-groups';
import { cn } from '../utils';
import { useState, useMemo } from 'react';
import type { ProcessRenderItem } from '../process-types';
import type { ChatMessage, ChatMessagePart, StreamingStatus } from '@extension/shared';

type PreviewMessageProps = {
  message: ChatMessage;
  isLoading: boolean;
  resetGeneration?: number;
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

const PreviewMessage = ({
  message,
  isLoading,
  resetGeneration = 0,
  setMessages,
  onEditSubmit,
}: PreviewMessageProps) => {
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const renderItems = useMemo<ProcessRenderItem[]>(
    () =>
      message.role === 'assistant'
        ? buildProcessGroups(message.id, message.parts, isLoading)
        : message.parts.map((part, index) => ({
            kind: 'part',
            key: `${message.id}:part:${index}`,
            part,
            index,
          })),
    [message.id, message.parts, message.role, isLoading],
  );

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

          {renderItems.map(item => {
            if (item.kind === 'process-group') {
              return <ProcessGroup group={item} key={`${resetGeneration}:${item.key}`} />;
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
                      'chat-user-bubble wrap-break-word w-fit rounded-2xl px-3 py-2 text-left':
                        message.role === 'user',
                      'bg-transparent px-0 py-0 text-left': message.role === 'assistant',
                    })}
                    data-testid="message-content">
                    {message.role === 'user' ? (
                      <UserResponse>{part.text}</UserResponse>
                    ) : (
                      <Response>{part.text}</Response>
                    )}
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
                | { id?: string; title?: string; kind?: string; content?: string }
                | undefined;
              const args = part.args as
                | { id?: string; title?: string; kind?: string; content?: string }
                | undefined;
              return (
                <div className="w-full" key={key}>
                  <DocumentPreview
                    chatId={message.chatId}
                    state={part.state}
                    args={
                      args
                        ? {
                            id: args.id,
                            title: args.title ?? 'Untitled',
                            kind: (args.kind ?? 'text') as 'text' | 'code' | 'sheet' | 'image',
                            content: args.content,
                          }
                        : undefined
                    }
                    result={
                      result?.id
                        ? {
                            id: result.id,
                            title: result.title ?? 'Untitled',
                            kind: (result.kind ?? 'text') as 'text' | 'code' | 'sheet' | 'image',
                            content: result.content,
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
