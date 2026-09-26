import { CompactionDivider } from './compaction-divider';
import { Greeting } from './greeting';
import { PreviewMessage, ThinkingMessage } from './message';
import { SubagentProgressCard, SubagentResultCard } from './subagent-progress-card';
import { SuggestedActions } from './suggested-actions';
import { useScrollToBottom } from '../hooks/use-scroll-to-bottom';
import { ArrowDownIcon } from 'lucide-react';
import type { ChatMessage, StreamingStatus, SubagentProgressInfo } from '@extension/shared';

const COMPACTION_IDS = new Set(['__compaction_summary__', '__compaction_marker__']);

type SubagentParsed = { runId: string; task: string; findings: string; artifactId?: string };

/** Parse subagent result from model field (live messages injected by Chat.tsx). */
const parseSubagentFromModel = (msg: ChatMessage): SubagentParsed | null => {
  if (msg.role !== 'system' || !msg.model?.startsWith('__subagent:')) return null;
  const [, runId, ...rest] = msg.model.split(':');
  const findings = msg.parts[0]?.type === 'text' ? msg.parts[0].text : '';
  // Legacy format: __subagent:<runId>:<task>
  if (rest.length === 1) {
    return { runId, task: rest[0], findings };
  }
  // New format: __subagent:<runId>:<artifactId?>:<task>
  const artifactId = rest[0] || undefined;
  const task = rest.slice(1).join(':');
  return { runId, task, findings, artifactId };
};

/** Parse subagent result from text content (DB-loaded messages). */
const parseSubagentFromText = (msg: ChatMessage): SubagentParsed | null => {
  if (msg.role !== 'system') return null;
  const text = msg.parts[0]?.type === 'text' ? msg.parts[0].text : '';
  const match = text.match(
    /^\[subagent-result runId=(.+?)(?:\s+artifactId=(.+?))?\]\n\nTask: (.+?)\n\n([\s\S]*)$/,
  );
  if (!match) return null;
  return { runId: match[1], task: match[3], findings: match[4], artifactId: match[2] };
};

const parseSubagentResult = (msg: ChatMessage) =>
  parseSubagentFromModel(msg) ?? parseSubagentFromText(msg);

type MessagesProps = {
  chatId: string;
  status: StreamingStatus;
  messages: ChatMessage[];
  setMessages?: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  onEditSubmit?: (messageId: string, content: string) => void;
  onSendMessage?: (content: string) => void;
  activeSubagents?: SubagentProgressInfo[];
  onStopSubagent?: (runId: string) => void;
};

const Messages = ({
  status,
  messages,
  setMessages,
  onEditSubmit,
  onSendMessage,
  activeSubagents,
  onStopSubagent,
}: MessagesProps) => {
  const { containerRef, endRef, isAtBottom, scrollToBottom } = useScrollToBottom();

  return (
    <div className="relative flex-1">
      <div
        className="absolute inset-0 touch-pan-y overflow-y-auto overflow-x-hidden"
        ref={containerRef}>
        <div
          className={`mx-auto flex min-w-0 max-w-4xl flex-col gap-4 px-2 py-4 md:gap-6 md:px-4 ${messages.length === 0 ? 'min-h-full justify-center' : ''}`}>
          {messages.length === 0 && (
            <>
              <Greeting />
              {onSendMessage && <SuggestedActions onSendMessage={onSendMessage} />}
            </>
          )}

          {messages.map((message, index) => {
            if (COMPACTION_IDS.has(message.id)) {
              return (
                <CompactionDivider
                  key={message.id}
                  summary={
                    message.parts[0]?.type === 'text'
                      ? message.parts[0].text.replace(/^\[Conversation summary\]\n?/, '')
                      : undefined
                  }
                />
              );
            }

            if (message.id.startsWith('__cmd_response__')) {
              return (
                <CompactionDivider
                  key={message.id}
                  summary={message.parts[0]?.type === 'text' ? message.parts[0].text : undefined}
                />
              );
            }

            const subResult = parseSubagentResult(message);
            if (subResult) {
              return <SubagentResultCard key={message.id} {...subResult} />;
            }

            return (
              <PreviewMessage
                isLoading={status === 'streaming' && messages.length - 1 === index}
                key={message.id}
                message={message}
                onEditSubmit={onEditSubmit}
                setMessages={setMessages}
              />
            );
          })}

          {activeSubagents?.map(sa => (
            <SubagentProgressCard key={sa.runId} info={sa} onStop={onStopSubagent} />
          ))}

          {status === 'connecting' && <ThinkingMessage />}

          <div className="min-h-[24px] min-w-[24px] shrink-0" ref={endRef} />
        </div>
      </div>

      <button
        aria-label="Scroll to bottom"
        className={`bg-background hover:bg-muted absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full border p-2 shadow-lg transition-all ${
          isAtBottom
            ? 'pointer-events-none scale-0 opacity-0'
            : 'pointer-events-auto scale-100 opacity-100'
        }`}
        onClick={() => scrollToBottom('smooth')}
        type="button">
        <ArrowDownIcon className="size-4" />
      </button>
    </div>
  );
};

export { Messages };
