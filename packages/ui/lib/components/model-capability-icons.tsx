import { useT } from '@extension/i18n';
import { modelCapabilities } from '@extension/shared';
import { BrainIcon, ImageIcon } from 'lucide-react';
import type { MessageKeyType } from '@extension/i18n';
import type { ChatModel, ModelCapability } from '@extension/shared';
import type { LucideIcon } from 'lucide-react';

const capabilityIcons: Record<
  Exclude<ModelCapability, 'text'>,
  { Icon: LucideIcon; label: MessageKeyType }
> = {
  image: { Icon: ImageIcon, label: 'model_supportsImages' },
  reasoning: { Icon: BrainIcon, label: 'model_supportsReasoning' },
};

type ModelCapabilityIconsProps = {
  model: Pick<ChatModel, 'supportsImages' | 'supportsReasoning'>;
};

const ModelCapabilityIcons = ({ model }: ModelCapabilityIconsProps) => {
  const t = useT();
  const capabilities = modelCapabilities(model).filter(capability => capability !== 'text');
  if (capabilities.length === 0) return null;

  return (
    <span className="text-muted-foreground inline-flex shrink-0 items-center gap-1">
      {capabilities.map(capability => {
        const { Icon, label } = capabilityIcons[capability];
        return (
          <span aria-label={t(label)} key={capability} role="img" title={t(label)}>
            <Icon aria-hidden className="size-4" />
          </span>
        );
      })}
    </span>
  );
};

export { ModelCapabilityIcons };
