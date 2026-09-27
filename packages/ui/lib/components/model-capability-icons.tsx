import { useT } from '@extension/i18n';
import { modelCapabilities } from '@extension/shared';
import { BrainCircuitIcon, ImageIcon, TypeIcon } from 'lucide-react';
import type { MessageKeyType } from '@extension/i18n';
import type { ChatModel, ModelCapability } from '@extension/shared';
import type { LucideIcon } from 'lucide-react';

const capabilityIcons: Record<ModelCapability, { Icon: LucideIcon; label: MessageKeyType }> = {
  text: { Icon: TypeIcon, label: 'model_supportsText' },
  image: { Icon: ImageIcon, label: 'model_supportsImages' },
  reasoning: { Icon: BrainCircuitIcon, label: 'model_supportsReasoning' },
};

type ModelCapabilityIconsProps = {
  model: Pick<ChatModel, 'supportsImages' | 'supportsReasoning'>;
};

const ModelCapabilityIcons = ({ model }: ModelCapabilityIconsProps) => {
  const t = useT();
  return (
    <span className="text-muted-foreground inline-flex shrink-0 items-center gap-1">
      {modelCapabilities(model).map(capability => {
        const { Icon, label } = capabilityIcons[capability];
        return (
          <span aria-label={t(label)} key={capability} role="img" title={t(label)}>
            <Icon aria-hidden className="size-3" />
          </span>
        );
      })}
    </span>
  );
};

export { ModelCapabilityIcons };
