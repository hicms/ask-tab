import { SuggestedActionIcon, getSuggestedActionTone } from './suggested-action-icon';
import { getLocale, LocaleContext } from '@extension/i18n';
import {
  suggestedActionsStorage,
  getDefaultSuggestedActions,
  isDefaultActions,
} from '@extension/storage';
import { motion } from 'framer-motion';
import { ChevronRightIcon } from 'lucide-react';
import { useContext, useSyncExternalStore } from 'react';

type SuggestedActionsProps = {
  onSendMessage: (message: string) => void;
};

const SuggestedActions = ({ onSendMessage }: SuggestedActionsProps) => {
  const stored = useSyncExternalStore(
    suggestedActionsStorage.subscribe,
    suggestedActionsStorage.getSnapshot,
  );
  // Re-render locale-appropriate defaults when the display language changes.
  useContext(LocaleContext);
  const actions =
    stored && isDefaultActions(stored) ? getDefaultSuggestedActions(getLocale()) : (stored ?? []);

  if (actions.length === 0) return null;

  return (
    <div
      className="mx-auto grid w-full max-w-3xl grid-cols-1 gap-3 px-2 sm:grid-cols-2 md:px-4"
      data-testid="suggested-actions">
      {actions.map((action, index) => (
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          initial={{ opacity: 0, y: 20 }}
          key={action.id}
          transition={{ delay: 0.05 * index }}>
          <button
            className={`group flex min-h-20 w-full items-center gap-3 rounded-2xl border bg-white/80 px-3 py-3 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 dark:border-slate-700 dark:bg-slate-900/80 dark:hover:bg-slate-800/80 ${getSuggestedActionTone(action.icon).card}`}
            onClick={() => onSendMessage(action.prompt)}
            title={action.label}
            type="button">
            <SuggestedActionIcon icon={action.icon} />
            <span className="line-clamp-2 min-w-0 flex-1 text-sm font-medium leading-5 text-slate-800 sm:text-base dark:text-slate-100">
              {action.label}
            </span>
            <ChevronRightIcon
              aria-hidden="true"
              className="size-4 shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5 dark:text-slate-500"
            />
          </button>
        </motion.div>
      ))}
    </div>
  );
};

export { SuggestedActions };
export type { SuggestedActionsProps };
