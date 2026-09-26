import { PreviewMessage, ThinkingMessage } from './message';
import { AnimatePresence } from 'framer-motion';
import { memo, useRef, useEffect, useState } from 'react';
import type { UIArtifact } from '../artifact-types';
import type { ChatMessage } from '@extension/shared';

type ArtifactMessagesProps = {
  chatId: string;
  status: string;
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  isReadonly: boolean;
  artifactStatus: UIArtifact['status'];
};

function PureArtifactMessages({
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  chatId,
  status,
  messages,
  setMessages,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  isReadonly,
}: ArtifactMessagesProps) {
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [_hasSentMessage, setHasSentMessage] = useState(false);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length]);

  useEffect(() => {
    if (status === 'streaming') {
      setHasSentMessage(true);
    }
  }, [status]);

  return (
    <div
      className="flex h-full flex-col items-center gap-4 overflow-y-scroll px-4 pt-20"
      ref={messagesContainerRef}>
      {messages.map((message, index) => (
        <PreviewMessage
          isLoading={status === 'streaming' && index === messages.length - 1}
          key={message.id}
          message={message}
          setMessages={setMessages}
        />
      ))}

      <AnimatePresence mode="wait">
        {status === 'submitted' && <ThinkingMessage key="thinking" />}
      </AnimatePresence>

      <div className="min-h-[24px] min-w-[24px] shrink-0" ref={messagesEndRef} />
    </div>
  );
}

function areEqual(prevProps: ArtifactMessagesProps, nextProps: ArtifactMessagesProps) {
  if (prevProps.artifactStatus === 'streaming' && nextProps.artifactStatus === 'streaming') {
    return true;
  }

  if (prevProps.status !== nextProps.status) {
    return false;
  }
  if (prevProps.status && nextProps.status) {
    return false;
  }
  if (prevProps.messages.length !== nextProps.messages.length) {
    return false;
  }

  return true;
}

export const ArtifactMessages = memo(PureArtifactMessages, areEqual);
