import type { ProcessSummary } from './process-types';
import type { TFunction } from '@extension/i18n';

const processTitle = (summary: ProcessSummary, closed: boolean, t: TFunction): string => {
  if (!closed) {
    const title = t(`process_running_${summary.running ?? 'thinking'}`);
    return summary.detail ? `${title} · ${summary.detail}` : title;
  }
  const labels = summary.counts.slice(0, 3).map(({ kind }) => t(`process_done_${kind}`));
  if (!labels.length) {
    if (summary.skipped) return t('process_allSkipped');
    return t(summary.resultOnly ? 'process_results' : 'process_done_thinking');
  }
  const continuation = (label: string) => label.charAt(0).toLowerCase() + label.slice(1);
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) {
    const prefix = t('process_sharedPrefix');
    const shared = prefix && labels.every(label => label.startsWith(prefix));
    return t('process_joinTwo', [
      labels[0],
      continuation(shared ? labels[1].slice(prefix.length) : labels[1]),
    ]);
  }
  const title = [labels[0], ...labels.slice(1).map(continuation)].join(t('process_comma'));
  return summary.counts.length > 3 ? t('process_more', title) : title;
};

export { processTitle };
