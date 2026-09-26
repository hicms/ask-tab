import { Reasoning, ReasoningContent, ReasoningTrigger } from './elements/reasoning';
import { useEffect, useState } from 'react';

type MessageReasoningProps = {
  isLoading: boolean;
  reasoning: string;
};

const MessageReasoning = ({ isLoading, reasoning }: MessageReasoningProps) => {
  const [hasBeenStreaming, setHasBeenStreaming] = useState(isLoading);

  useEffect(() => {
    if (isLoading) {
      setHasBeenStreaming(true);
    }
  }, [isLoading]);

  return (
    <Reasoning
      data-testid="message-reasoning"
      defaultOpen={hasBeenStreaming}
      isStreaming={isLoading}>
      <ReasoningTrigger />
      <ReasoningContent>{reasoning}</ReasoningContent>
    </Reasoning>
  );
};

export { MessageReasoning };
