import { cn } from '../utils';
import { useT } from '@extension/i18n';
import { formatPriceMultiplier } from '@extension/shared';

const ModelPriceMultiplier = ({
  multiplier,
  className,
}: {
  multiplier?: number;
  className?: string;
}) => {
  const t = useT();
  if (!multiplier) return null;
  return (
    <span
      className={cn('text-muted-foreground shrink-0 text-xs tabular-nums', className)}
      data-testid="model-price-multiplier"
      title={t('model_priceMultiplier')}>
      {formatPriceMultiplier(multiplier)}
    </span>
  );
};

export { ModelPriceMultiplier };
