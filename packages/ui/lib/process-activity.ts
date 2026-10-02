import type { ProcessActivity, ProcessGroup, ProcessSummary } from './process-types';

const processActivity = (name: string, args: Record<string, unknown>): ProcessActivity => {
  switch (name) {
    case 'read':
      return 'read';
    case 'write':
      return 'write';
    case 'edit':
      return 'edit';
    case 'list':
    case 'delete':
    case 'rename':
      return 'files';
    case 'web_search':
    case 'deep_research':
      return 'webSearch';
    case 'web_fetch':
      return 'webFetch';
    case 'browser':
      return 'browser';
    case 'execute_javascript':
      return args.action === 'execute' || args.action === 'bundle' ? 'code' : 'tools';
    case 'memory_search':
    case 'memory_get':
      return 'memory';
    case 'spawn_subagent':
    case 'list_subagents':
    case 'kill_subagent':
      return 'subagents';
    default:
      return 'tools';
  }
};

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const normalizeDetail = (text: string): string => {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const characters = Array.from(segmenter.segment(normalized), value => value.segment);
  return characters.length <= 160 ? normalized : `${characters.slice(0, 159).join('').trimEnd()}…`;
};

const detailKeys = [
  'title',
  'description',
  'objective',
  'task',
  'task_name',
  'name',
  'question',
  'questions',
  'prompt',
  'message',
  'command',
  'cmd',
  'queries',
  'query',
  'pattern',
  'url',
  'uri',
  'file_path',
  'path',
  'target',
  'action',
  'status',
] as const;

const stringDetail = (value: unknown): string =>
  typeof value === 'string'
    ? normalizeDetail(value)
    : Array.isArray(value) && value.every(item => typeof item === 'string')
      ? normalizeDetail(value.join(', '))
      : '';

const toolDetail = (name: string, args: Record<string, unknown>): string => {
  for (const key of detailKeys) {
    const value = args[key];
    if (key === 'questions' && Array.isArray(value)) {
      for (const question of value) {
        if (question && typeof question === 'object') {
          const detail = stringDetail(question.question);
          if (detail) return detail;
        }
      }
    } else {
      const detail = stringDetail(value);
      if (detail) return detail;
    }
  }
  return normalizeDetail(name);
};

const summarizeProcessGroup = (group: ProcessGroup): ProcessSummary => {
  const counts = new Map<ProcessActivity, number>();
  const seen = new Set<string>();
  const summary: ProcessSummary = {
    counts: [],
    detail: '',
    errors: 0,
    skipped: 0,
    unknown: 0,
    resultOnly: group.members.every(member => member.kind === 'result'),
  };
  let reasoning = '';
  for (const member of group.members) {
    if (member.kind === 'reasoning' && member.running) {
      reasoning =
        member.text
          .split(/\r?\n[\t ]*\r?\n/)
          .filter(text => text.trim())
          .at(-1) ?? '';
    }
    if (member.kind === 'result') {
      if (member.skipped) summary.skipped++;
      else if (member.state === 'output-error') summary.errors++;
      continue;
    }
    if (member.kind !== 'tool' || seen.has(member.call.toolCallId)) continue;
    seen.add(member.call.toolCallId);
    if (member.skipped) {
      summary.skipped++;
      continue;
    }
    const kind = processActivity(member.call.toolName, member.call.args);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
    if (member.state === 'output-error') summary.errors++;
    if (member.state === 'unknown') summary.unknown++;
    if (
      !group.closed &&
      (member.state === 'input-available' || member.state === 'input-streaming')
    ) {
      summary.running = kind;
      summary.detail = toolDetail(member.call.toolName, member.call.args);
    }
  }
  summary.counts = [...counts]
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => b.count - a.count);
  if (!group.closed && !summary.running)
    summary.detail = normalizeDetail(reasoning.replaceAll('**', ''));
  return summary;
};

export { processActivity, summarizeProcessGroup };
