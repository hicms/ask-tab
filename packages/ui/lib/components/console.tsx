import { Loader } from './elements/loader';
import { CrossIcon } from './icons';
import { Button } from './ui';
import { useArtifactSelector } from '../hooks/use-artifact';
import { cn } from '../utils';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

export type ConsoleOutputContent = {
  type: 'text' | 'image';
  value: string;
};

export type ConsoleOutput = {
  id: string;
  status: 'in_progress' | 'loading_packages' | 'completed' | 'failed';
  contents: ConsoleOutputContent[];
};

type ConsoleProps = {
  consoleOutputs: ConsoleOutput[];
  setConsoleOutputs: Dispatch<SetStateAction<ConsoleOutput[]>>;
};

/**
 * Terminal-style resizable console panel for displaying code execution output.
 * Ported from ai-chatbot — kept for future code execution support.
 */
export function Console({ consoleOutputs, setConsoleOutputs }: ConsoleProps) {
  const [height, setHeight] = useState<number>(300);
  const [isResizing, setIsResizing] = useState(false);
  const consoleEndRef = useRef<HTMLDivElement>(null);

  const isArtifactVisible = useArtifactSelector(state => state.isVisible);

  const minHeight = 100;
  const maxHeight = 800;

  const startResizing = useCallback(() => {
    setIsResizing(true);
  }, []);

  const stopResizing = useCallback(() => {
    setIsResizing(false);
  }, []);

  const resize = useCallback(
    (e: MouseEvent) => {
      if (isResizing) {
        const newHeight = window.innerHeight - e.clientY;
        if (newHeight >= minHeight && newHeight <= maxHeight) {
          setHeight(newHeight);
        }
      }
    },
    [isResizing],
  );

  useEffect(() => {
    window.addEventListener('mousemove', resize);
    window.addEventListener('mouseup', stopResizing);
    return () => {
      window.removeEventListener('mousemove', resize);
      window.removeEventListener('mouseup', stopResizing);
    };
  }, [resize, stopResizing]);

  useEffect(() => {
    consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    if (!isArtifactVisible) {
      setConsoleOutputs([]);
    }
  }, [isArtifactVisible, setConsoleOutputs]);

  return consoleOutputs.length > 0 ? (
    <>
      {/* Resize handle */}
      <div
        aria-label="Resize console"
        aria-orientation="horizontal"
        aria-valuemax={maxHeight}
        aria-valuemin={minHeight}
        aria-valuenow={height}
        className="fixed z-50 h-2 w-full cursor-ns-resize"
        onKeyDown={e => {
          if (e.key === 'ArrowUp') {
            setHeight(prev => Math.min(prev + 10, maxHeight));
          } else if (e.key === 'ArrowDown') {
            setHeight(prev => Math.max(prev - 10, minHeight));
          }
        }}
        onMouseDown={startResizing}
        role="slider"
        style={{ bottom: height - 4 }}
        tabIndex={0}
      />

      {/* Console panel */}
      <div
        className={cn(
          'fixed bottom-0 z-40 flex w-full flex-col overflow-x-hidden overflow-y-scroll border-t border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900',
          {
            'select-none': isResizing,
          },
        )}
        style={{ height }}>
        {/* Header */}
        <div className="bg-muted sticky top-0 z-50 flex h-fit w-full flex-row items-center justify-between border-b border-zinc-200 px-2 py-1 dark:border-zinc-700">
          <div className="flex flex-row items-center gap-3 pl-2 text-sm text-zinc-800 dark:text-zinc-50">
            <div className="text-muted-foreground">
              {/* Terminal icon inline SVG */}
              <svg
                fill="none"
                height="16"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                viewBox="0 0 24 24"
                width="16">
                <polyline points="4 17 10 11 4 5" />
                <line x1="12" x2="20" y1="19" y2="19" />
              </svg>
            </div>
            <div>Console</div>
          </div>
          <Button
            className="size-fit p-1 hover:bg-zinc-200 dark:hover:bg-zinc-700"
            onClick={() => setConsoleOutputs([])}
            size="icon"
            variant="ghost">
            <CrossIcon size={14} />
          </Button>
        </div>

        {/* Output rows */}
        <div>
          {consoleOutputs.map((consoleOutput, index) => (
            <div
              className="flex flex-row border-b border-zinc-200 bg-zinc-50 px-4 py-2 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-900"
              key={consoleOutput.id}>
              <div
                className={cn('w-12 shrink-0', {
                  'text-muted-foreground': ['in_progress', 'loading_packages'].includes(
                    consoleOutput.status,
                  ),
                  'text-emerald-500': consoleOutput.status === 'completed',
                  'text-red-400': consoleOutput.status === 'failed',
                })}>
                [{index + 1}]
              </div>
              {['in_progress', 'loading_packages'].includes(consoleOutput.status) ? (
                <div className="flex flex-row gap-2">
                  <div className="mb-auto mt-0.5 size-fit self-center">
                    <Loader size={16} />
                  </div>
                  <div className="text-muted-foreground">
                    {consoleOutput.status === 'in_progress'
                      ? 'Initializing...'
                      : consoleOutput.status === 'loading_packages'
                        ? consoleOutput.contents.map(content =>
                            content.type === 'text' ? content.value : null,
                          )
                        : null}
                  </div>
                </div>
              ) : (
                <div className="flex w-full flex-col gap-2 overflow-x-scroll text-zinc-900 dark:text-zinc-50">
                  {consoleOutput.contents.map((content, contentIndex) =>
                    content.type === 'image' ? (
                      <picture key={`${consoleOutput.id}-${contentIndex}`}>
                        <img
                          alt="output"
                          className="w-full max-w-sm rounded-md"
                          src={content.value}
                        />
                      </picture>
                    ) : (
                      <div
                        className="w-full whitespace-pre-line break-words"
                        key={`${consoleOutput.id}-${contentIndex}`}>
                        {content.value}
                      </div>
                    ),
                  )}
                </div>
              )}
            </div>
          ))}
          <div ref={consoleEndRef} />
        </div>
      </div>
    </>
  ) : null;
}
