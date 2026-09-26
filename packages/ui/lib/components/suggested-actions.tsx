import { getLocale, LocaleContext } from '@extension/i18n';
import {
  suggestedActionsStorage,
  getDefaultSuggestedActions,
  isDefaultActions,
} from '@extension/storage';
import { motion } from 'framer-motion';
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
    <div className="grid w-full grid-cols-2 gap-2" data-testid="suggested-actions">
      {actions.map((action, index) => (
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          initial={{ opacity: 0, y: 20 }}
          key={action.id}
          transition={{ delay: 0.05 * index }}>
          <button
            className="text-muted-foreground hover:bg-muted hover:text-foreground w-full rounded-lg border p-3 text-left text-sm transition-colors"
            onClick={() => onSendMessage(action.prompt)}
            type="button">
            {action.label}
          </button>
        </motion.div>
      ))}
    </div>
  );
};

export { SuggestedActions };
export type { SuggestedActionsProps };
