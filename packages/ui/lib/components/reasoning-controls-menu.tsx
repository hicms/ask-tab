import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui';
import { useT } from '@extension/i18n';
import {
  formatReasoningValue,
  isSelectableReasoningControl,
  resolveReasoningSettings,
  sameReasoningValue,
  useStorage,
} from '@extension/shared';
import { publicModelsStorage, reasoningSelectionsStorage } from '@extension/storage';
import { BrainIcon } from 'lucide-react';
import { Fragment, useMemo } from 'react';
import type { ReasoningValue } from '@extension/storage';

type ReasoningControlsMenuProps = {
  /** Public model ID, as sent to the relay. */
  modelId?: string;
};

/** Lets the user pick the thinking parameters the selected model publishes. */
const ReasoningControlsMenu = ({ modelId }: ReasoningControlsMenuProps) => {
  const t = useT();
  const publicModels = useStorage(publicModelsStorage);
  const selections = useStorage(reasoningSelectionsStorage);

  const controls = useMemo(
    () =>
      publicModels
        .find(model => model.id === modelId && model.kind === 'chat')
        ?.reasoningControls?.filter(isSelectableReasoningControl) ?? [],
    [publicModels, modelId],
  );
  if (!modelId || controls.length === 0) return null;

  const current = resolveReasoningSettings(controls, selections[modelId]);
  const summary = current
    .map(({ path, value }) => `${path}: ${formatReasoningValue(value)}`)
    .join('\n');

  const choose = (path: string, value: ReasoningValue) =>
    void reasoningSelectionsStorage.set(prev => ({
      ...prev,
      [modelId]: { ...prev[modelId], [path]: value },
    }));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={t('chat_reasoningOptions')}
          className="chat-action-button text-muted-foreground hover:text-foreground size-10 shrink-0 rounded-lg [&_svg]:size-5"
          data-testid="reasoning-controls-button"
          size="icon"
          title={`${t('chat_reasoningOptions')}\n${summary}`}
          type="button"
          variant="ghost">
          <BrainIcon className="size-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-[60vh] min-w-52 max-w-[calc(100vw-20px)] overflow-y-auto"
        side="top">
        {controls.map((control, index) => {
          const selected = control.values.findIndex(value =>
            sameReasoningValue(value, current[index].value),
          );
          return (
            <Fragment key={control.path}>
              {index > 0 && <DropdownMenuSeparator />}
              <DropdownMenuLabel className="text-muted-foreground break-all font-mono text-xs font-normal">
                {control.path}
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup
                onValueChange={value => choose(control.path, control.values[Number(value)])}
                value={String(selected)}>
                {control.values.map((value, valueIndex) => (
                  <DropdownMenuRadioItem
                    key={formatReasoningValue(value)}
                    onSelect={event => event.preventDefault()}
                    value={String(valueIndex)}>
                    <span className="min-w-0 truncate">{formatReasoningValue(value)}</span>
                    {sameReasoningValue(value, control.default) && (
                      <span className="text-muted-foreground ml-auto pl-4 text-xs">
                        {t('chat_reasoningDefault')}
                      </span>
                    )}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </Fragment>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export { ReasoningControlsMenu };
export type { ReasoningControlsMenuProps };
