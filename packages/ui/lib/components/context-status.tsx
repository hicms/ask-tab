import { HoverCard, HoverCardContent, HoverCardTrigger } from './ui';
import { GaugeIcon } from 'lucide-react';
import { useMemo } from 'react';

type ContextStatusBadgeProps = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  compactionCount: number;
  contextLimit: number;
  lastCompactionMethod?: string;
  lastCompactionTokensSaved?: number;
};

const formatTokenCount = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
};

const ContextStatusBadge = ({
  inputTokens,
  outputTokens,
  totalTokens,
  compactionCount,
  contextLimit,
  lastCompactionMethod,
  lastCompactionTokensSaved,
}: ContextStatusBadgeProps) => {
  const ratio = useMemo(
    () => (contextLimit > 0 ? Math.min(totalTokens / contextLimit, 1) : 0),
    [totalTokens, contextLimit],
  );

  const colorClass = useMemo(() => {
    if (ratio > 0.8) return 'text-red-600 dark:text-red-400';
    if (ratio > 0.5) return 'text-yellow-600 dark:text-yellow-400';
    return 'text-green-600 dark:text-green-400';
  }, [ratio]);

  const percent = Math.round(ratio * 100);

  if (totalTokens === 0) return null;

  return (
    <HoverCard>
      <HoverCardTrigger asChild>
        <button
          className="hover:bg-muted flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs transition-colors"
          title={`Context: ${percent}%`}
          type="button">
          <GaugeIcon className={`size-3 ${colorClass}`} />
          <span className={colorClass}>{percent}%</span>
        </button>
      </HoverCardTrigger>
      <HoverCardContent align="end" className="w-52 p-3 text-xs">
        <div className="space-y-2">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Input</span>
            <span className="font-mono">{formatTokenCount(inputTokens)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Output</span>
            <span className="font-mono">{formatTokenCount(outputTokens)}</span>
          </div>
          <div className="bg-border my-1 h-px" />
          <div className="flex justify-between font-medium">
            <span>Total</span>
            <span className="font-mono">{formatTokenCount(totalTokens)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Effective Limit</span>
            <span className="font-mono">{formatTokenCount(contextLimit)}</span>
          </div>
          {/* Progress bar */}
          <div className="bg-muted h-1.5 overflow-hidden rounded-full">
            <div
              className={`h-full rounded-full transition-all ${
                ratio > 0.8 ? 'bg-red-500' : ratio > 0.5 ? 'bg-yellow-500' : 'bg-green-500'
              }`}
              style={{ width: `${percent}%` }}
            />
          </div>
          {compactionCount > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Compactions</span>
              <span className="font-mono">{compactionCount}</span>
            </div>
          )}
          {lastCompactionMethod && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Last method</span>
              <span className="font-mono">{lastCompactionMethod}</span>
            </div>
          )}
          {lastCompactionTokensSaved != null && lastCompactionTokensSaved > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Tokens saved</span>
              <span className="font-mono">~{formatTokenCount(lastCompactionTokensSaved)}</span>
            </div>
          )}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
};

export { ContextStatusBadge };
export type { ContextStatusBadgeProps };
