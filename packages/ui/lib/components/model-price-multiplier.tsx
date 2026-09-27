import { useT } from '@extension/i18n';
import { formatPriceMultiplier } from '@extension/shared';

const ModelPriceMultiplier = ({ multiplier }: { multiplier?: number }) => {
  const t = useT();
  if (!multiplier) return null;
  return (
    <span
      className="text-muted-foreground shrink-0 text-xs tabular-nums"
      data-testid="model-price-multiplier"
      title={t('model_priceMultiplier')}>
      {formatPriceMultiplier(multiplier)}
    </span>
  );
};

export { ModelPriceMultiplier };
