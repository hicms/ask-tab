import { useT } from '@extension/i18n';
import { LoaderCircle } from 'lucide-react';

export const RunningChatIndicator = () => {
  const t = useT();
  return (
    <span className="text-primary inline-flex shrink-0 items-center gap-1 text-xs" role="status">
      <LoaderCircle aria-hidden="true" className="size-3 animate-spin" />
      {t('session_running')}
    </span>
  );
};
