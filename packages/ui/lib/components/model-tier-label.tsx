import { useT } from '@extension/i18n';
import { knownTier } from '@extension/shared';
import type { MessageKeyType } from '@extension/i18n';
import type { ModelTier } from '@extension/storage';

const tierLabels: Record<ModelTier, MessageKeyType> = {
  flagship: 'model_tierFlagship',
  balanced: 'model_tierBalanced',
  fast: 'model_tierFast',
};

const ModelTierLabel = ({ tier: stored }: { tier?: ModelTier }) => {
  const t = useT();
  const tier = knownTier(stored);
  if (!tier) return null;
  return (
    <span
      className="text-muted-foreground shrink-0 rounded border px-1 text-[10px] leading-4"
      data-tier={tier}>
      {t(tierLabels[tier])}
    </span>
  );
};

export { ModelTierLabel, tierLabels };
