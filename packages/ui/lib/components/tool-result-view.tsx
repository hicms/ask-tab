import { SearchResults, parseSearchResults } from './search-results';
import { cn } from '../utils';
import { CheckCircle2Icon, ExternalLinkIcon, XCircleIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

/** "createdAt" → "Created At", "tab_id" → "Tab Id" */
const formatKey = (key: string): string => {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
  return spaced
    .split(' ')
    .filter(Boolean)
    .map(w => w[0].toUpperCase() + w.slice(1))
    .join(' ');
};

const isUrlLike = (value: string): boolean => /^https?:\/\/\S+$/i.test(value.trim());

const MAX_HUMANIZE_DEPTH = 3;

/**
 * Recursively renders a JSON value as an indented label/value tree instead
 * of a raw JSON blob — objects become "Label: value" rows, arrays become
 * bullet lists, URLs become links. Falls back to a short placeholder past
 * a depth cap to avoid runaway nesting.
 */
const HumanizedValue = ({ value, depth = 0 }: { value: unknown; depth?: number }) => {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground italic">—</span>;
  }

  if (typeof value === 'string') {
    if (isUrlLike(value)) {
      return (
        <a
          className="break-all text-blue-600 hover:underline dark:text-blue-400"
          href={value}
          rel="noopener noreferrer"
          target="_blank">
          {value}
        </a>
      );
    }
    return <span className="whitespace-pre-wrap break-words">{value}</span>;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return <span>{String(value)}</span>;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-muted-foreground italic">Empty list</span>;
    if (depth >= MAX_HUMANIZE_DEPTH) {
      return <span className="text-muted-foreground italic">{value.length} item(s)</span>;
    }
    return (
      <div className="space-y-1">
        {value.map((item, i) => (
          <div className="flex gap-1.5" key={i}>
            <span className="text-muted-foreground select-none">·</span>
            <div className="min-w-0 flex-1">
              <HumanizedValue depth={depth + 1} value={item} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([, v]) => v !== undefined,
    );
    if (entries.length === 0) return <span className="text-muted-foreground italic">Empty</span>;
    if (depth >= MAX_HUMANIZE_DEPTH) {
      return <span className="text-muted-foreground italic">{`{${entries.length} field(s)}`}</span>;
    }
    return (
      <div className="space-y-1">
        {entries.map(([k, v]) => (
          <div className="flex gap-2" key={k}>
            <span className="text-muted-foreground shrink-0">{formatKey(k)}:</span>
            <div className="min-w-0 flex-1">
              <HumanizedValue depth={depth + 1} value={v} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return <span>{String(value)}</span>;
};

/**
 * Shows an object/array as a human-readable label/value tree by default,
 * with a small toggle to switch to the raw JSON — used for both tool
 * parameters and generic (non-specially-formatted) tool results.
 */
const FormattedOrRawView = ({ data, className }: { data: unknown; className?: string }) => {
  const [showRaw, setShowRaw] = useState(false);
  const canHumanize = data !== null && typeof data === 'object';

  return (
    <div className="space-y-1">
      <ExpandableBlock
        className={cn(showRaw || !canHumanize ? 'bg-muted/50' : undefined, className)}>
        {showRaw || !canHumanize ? (
          <pre className="max-w-full whitespace-pre-wrap break-words p-2 font-mono text-xs">
            {typeof data === 'string' ? data : JSON.stringify(data, null, 2)}
          </pre>
        ) : (
          <div className="p-2 text-xs">
            <HumanizedValue value={data} />
          </div>
        )}
      </ExpandableBlock>
      {canHumanize && (
        <button
          className="text-muted-foreground hover:text-foreground text-[11px] underline decoration-dotted hover:no-underline"
          onClick={() => setShowRaw(r => !r)}
          type="button">
          {showRaw ? 'Show formatted' : 'Show raw JSON'}
        </button>
      )}
    </div>
  );
};

/**
 * Scrollable block capped at a reasonable height, with a "show full
 * content" toggle that only appears when the content actually overflows —
 * keeps large tool results from blowing up the message flow while still
 * making the raw data reachable in one click.
 */
const ExpandableBlock = ({ children, className }: { children: ReactNode; className?: string }) => {
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Disclosures keep their contents mounted while hidden. Recheck when the
  // block becomes visible or its contents resize, without resetting expansion.
  useEffect(() => {
    const el = ref.current;
    if (!el || expanded) return;
    const measure = () => {
      if (el.clientHeight > 0) setOverflowing(el.scrollHeight > el.clientHeight + 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, [expanded]);

  return (
    <div className="space-y-1">
      <div
        className={cn(
          'overflow-auto rounded-md',
          expanded ? 'max-h-[60vh]' : 'max-h-56',
          className,
        )}
        ref={ref}>
        {children}
      </div>
      {overflowing && (
        <button
          className="text-muted-foreground hover:text-foreground text-[11px] underline decoration-dotted hover:no-underline"
          onClick={() => setExpanded(e => !e)}
          type="button">
          {expanded ? 'Show less' : 'Show full content'}
        </button>
      )}
    </div>
  );
};

type WebFetchResult = {
  text?: string;
  title?: string;
  status?: number;
  mimeType?: string;
  sizeBytes?: number;
  isBase64?: boolean;
  error?: string;
};

const WebFetchResultView = ({ result, url }: { result: WebFetchResult; url?: string }) => {
  const ok = result.status != null && result.status >= 200 && result.status < 400;
  return (
    <div className="space-y-2 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {result.title && <div className="truncate text-sm font-medium">{result.title}</div>}
          {url && (
            <a
              className="text-muted-foreground hover:text-foreground inline-flex max-w-full items-center gap-1 truncate text-xs hover:underline"
              href={url}
              rel="noopener noreferrer"
              target="_blank">
              <span className="truncate">{url}</span>
              <ExternalLinkIcon className="size-3 shrink-0" />
            </a>
          )}
        </div>
        {result.status != null && (
          <div
            className={cn(
              'flex shrink-0 items-center gap-1 text-xs',
              ok ? 'text-green-600' : 'text-red-600',
            )}>
            {ok ? <CheckCircle2Icon className="size-3.5" /> : <XCircleIcon className="size-3.5" />}
            {result.status}
          </div>
        )}
      </div>
      {result.error && <div className="text-destructive text-xs">{result.error}</div>}
      {result.text && !result.isBase64 && (
        <ExpandableBlock className="bg-muted/50">
          <pre className="whitespace-pre-wrap break-words p-3 font-mono text-xs">{result.text}</pre>
        </ExpandableBlock>
      )}
    </div>
  );
};

type ToolResultViewProps = {
  toolName: string;
  result: unknown;
  args?: Record<string, unknown>;
};

/**
 * Renders a tool's result with per-tool formatting where it materially
 * helps readability (web_search, web_fetch); everything else falls back to
 * plain text (for string results — most tools already return a
 * human-readable message) or capped, scrollable JSON.
 */
const ToolResultView = ({ toolName, result, args }: ToolResultViewProps) => {
  if (toolName === 'web_search') {
    const results = parseSearchResults(result);
    if (results.length > 0) {
      return (
        <div className="p-3">
          <SearchResults results={results} />
        </div>
      );
    }
  }

  if (toolName === 'web_fetch' && result && typeof result === 'object' && !Array.isArray(result)) {
    return (
      <WebFetchResultView result={result as WebFetchResult} url={args?.url as string | undefined} />
    );
  }

  if (typeof result === 'string') {
    return (
      <div className="p-3">
        <ExpandableBlock>
          <pre className="whitespace-pre-wrap break-words font-mono text-xs">{result}</pre>
        </ExpandableBlock>
      </div>
    );
  }

  return (
    <div className="p-3">
      <FormattedOrRawView data={result} />
    </div>
  );
};

export { ToolResultView, ExpandableBlock, FormattedOrRawView };
