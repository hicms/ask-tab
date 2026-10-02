import { Reasoning, ReasoningContent, ReasoningTrigger } from './elements/reasoning';
import { useT } from '@extension/i18n';
import { BrainIcon, ChevronDownIcon } from 'lucide-react';
import { useState } from 'react';

type MessageReasoningProps = {
  isLoading: boolean;
  reasoning: string;
};

const MessageReasoning = ({ isLoading, reasoning }: MessageReasoningProps) => {
  const t = useT();
  const [open, setOpen] = useState(false);

  return (
    <Reasoning
      data-testid="message-reasoning"
      defaultOpen={false}
      onOpenChange={setOpen}
      open={open}
      isStreaming={isLoading}>
      <ReasoningTrigger>
        <BrainIcon className="size-3 text-purple-600 dark:text-purple-400" />
        {t('process_reasoning')}
        <ChevronDownIcon className={`size-2.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </ReasoningTrigger>
      <ReasoningContent forceMount hidden={!open}>
        {reasoning}
      </ReasoningContent>
    </Reasoning>
  );
};

export { MessageReasoning };
