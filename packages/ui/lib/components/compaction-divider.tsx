import { ChevronDownIcon, ChevronRightIcon, ScissorsIcon } from 'lucide-react';
import { useState } from 'react';

type CompactionDividerProps = {
  summary?: string;
};

const CompactionDivider = ({ summary }: CompactionDividerProps) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="flex flex-col items-center gap-1 py-2">
      <button
        className="text-muted-foreground hover:text-foreground flex items-center gap-2 text-xs transition-colors"
        onClick={() => setExpanded(prev => !prev)}
        type="button">
        <div className="bg-border h-px w-8" />
        <ScissorsIcon className="size-3" />
        <span>Earlier messages summarized</span>
        {summary &&
          (expanded ? (
            <ChevronDownIcon className="size-3" />
          ) : (
            <ChevronRightIcon className="size-3" />
          ))}
        <div className="bg-border h-px w-8" />
      </button>
      {expanded && summary && (
        <div className="bg-muted text-muted-foreground mx-auto max-w-2xl whitespace-pre-wrap rounded-md px-3 py-2 text-xs">
          {summary}
        </div>
      )}
    </div>
  );
};

export { CompactionDivider };
