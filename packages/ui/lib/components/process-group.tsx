import { MessageReasoning } from './message-reasoning';
import { ToolCallPart } from './tool-call-part';
import { processActivity, summarizeProcessGroup } from '../process-activity';
import { processTitle } from '../process-title';
import { getToolIcon } from '../tool-call-summary';
import { cn } from '../utils';
import { useT } from '@extension/i18n';
import { BrainIcon, ChevronDownIcon, WrenchIcon } from 'lucide-react';
import { memo, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ProcessGroup as Group } from '../process-types';

const useLiveTitle = (title: string, closed: boolean): string => {
  const [displayed, setDisplayed] = useState(title);
  const displayedAt = useRef(Date.now());
  useEffect(() => {
    if (closed || title === displayed) return;
    const commit = () => {
      displayedAt.current = Date.now();
      setDisplayed(title);
    };
    const remaining = 150 - (Date.now() - displayedAt.current);
    if (remaining <= 0) {
      commit();
      return;
    }
    const timer = setTimeout(commit, remaining);
    return () => clearTimeout(timer);
  }, [title, closed, displayed]);
  return closed ? title : displayed;
};

const ProcessGroup = memo(({ group }: { group: Group }) => {
  const t = useT();
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const summary = useMemo(() => summarizeProcessGroup(group), [group]);
  const title = useLiveTitle(processTitle(summary, group.closed, t), group.closed);
  const activity = group.closed ? summary.counts[0]?.kind : summary.running;
  const tool = group.members.find(
    member =>
      member.kind === 'tool' &&
      processActivity(member.call.toolName, member.call.args) === activity,
  );
  const Icon =
    tool?.kind === 'tool'
      ? getToolIcon(tool.call.toolName)
      : summary.resultOnly
        ? WrenchIcon
        : BrainIcon;
  const notices = [
    summary.errors ? t('process_errors', String(summary.errors)) : '',
    summary.skipped ? t('process_skipped', String(summary.skipped)) : '',
    summary.unknown ? t('process_unknown', String(summary.unknown)) : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="my-1 w-full min-w-0" data-closed={group.closed} data-testid="process-group">
      <button
        aria-controls={bodyId}
        aria-expanded={open}
        className="text-muted-foreground hover:text-foreground hover:bg-muted/50 flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-xs focus-visible:outline focus-visible:outline-2"
        data-testid="process-group-toggle"
        onClick={event => {
          event.currentTarget.focus();
          setOpen(value => !value);
        }}
        title={title}
        type="button">
        <Icon className={cn('size-3.5 shrink-0', !group.closed && 'motion-safe:animate-pulse')} />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <ChevronDownIcon
          className={cn('size-3.5 shrink-0 transition-transform', open && 'rotate-180')}
        />
      </button>
      {notices && (
        <div className="text-muted-foreground px-7 pb-1 text-[11px]" data-testid="process-notices">
          {notices}
        </div>
      )}
      <div hidden={!open} id={bodyId}>
        <div className="mt-2 flex min-w-0 flex-col gap-1.5 pl-1">
          {group.members.map(member => {
            if (member.kind === 'reasoning')
              return (
                <MessageReasoning
                  isLoading={member.running}
                  key={member.key}
                  reasoning={member.text}
                />
              );
            if (member.kind === 'result')
              return (
                <ToolCallPart
                  hasResult
                  key={member.key}
                  result={member.part.result}
                  skipped={member.skipped}
                  state={member.state}
                  toolName={member.part.toolName}
                />
              );
            return (
              <ToolCallPart
                args={member.call.args}
                hasResult={member.hasResult}
                key={member.key}
                result={member.result}
                skipped={member.skipped}
                state={member.state}
                toolName={member.call.toolName}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
});
ProcessGroup.displayName = 'ProcessGroup';

export { ProcessGroup };
