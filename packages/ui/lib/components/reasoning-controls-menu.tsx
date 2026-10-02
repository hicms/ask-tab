import {
  primaryReasoningControl,
  reasoningControlLabel,
  reasoningValueLabel,
} from './reasoning-control-labels';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
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
import { Fragment, useMemo, useRef, useState } from 'react';
import type { ReasoningControl, ReasoningValue } from '@extension/storage';

type ReasoningControlsMenuProps = {
  /** Public model ID, as sent to the relay. */
  modelId?: string;
};

type Translate = ReturnType<typeof useT>;

/** Falls back to the raw value when two values of one control would read the same. */
const valueLabels = (t: Translate, control: ReasoningControl): string[] => {
  const labels = control.values.map(value => reasoningValueLabel(t, control, value));
  return new Set(labels).size === labels.length ? labels : control.values.map(formatReasoningValue);
};

/** Lets the user pick the thinking parameters the selected model publishes. */
const ReasoningControlsMenu = ({ modelId }: ReasoningControlsMenuProps) => {
  const t = useT();
  const publicModels = useStorage(publicModelsStorage);
  const selections = useStorage(reasoningSelectionsStorage);
  const [menuOpen, setMenuOpen] = useState(false);
  const [tooltipOpen, setTooltipOpen] = useState(false);
  // Closing the menu returns focus to the trigger, which would pop the tooltip back up.
  const tooltipAllowed = useRef(true);

  const controls = useMemo(
    () =>
      publicModels
        .find(model => model.id === modelId && model.kind === 'chat')
        ?.reasoningControls?.filter(isSelectableReasoningControl) ?? [],
    [publicModels, modelId],
  );
  if (!modelId || controls.length === 0) return null;

  const current = resolveReasoningSettings(controls, selections[modelId]);
  const rows = controls.map((control, index) => {
    const labels = valueLabels(t, control);
    const selected = control.values.findIndex(value =>
      sameReasoningValue(value, current[index].value),
    );
    return { control, labels, selected, label: reasoningControlLabel(t, control) };
  });
  const primary = primaryReasoningControl(controls);
  const primaryRow = rows.find(row => row.control === primary);
  const chipText = primaryRow ? primaryRow.labels[primaryRow.selected] : undefined;

  const choose = (path: string, value: ReasoningValue) =>
    void reasoningSelectionsStorage.set(prev => ({
      ...prev,
      [modelId]: { ...prev[modelId], [path]: value },
    }));

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip
        onOpenChange={open => setTooltipOpen(open && tooltipAllowed.current)}
        open={tooltipOpen && !menuOpen}>
        <DropdownMenu
          onOpenChange={open => {
            setMenuOpen(open);
            if (!open) tooltipAllowed.current = false;
          }}
          open={menuOpen}>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label={t('chat_reasoningOptions')}
                className="chat-model-select text-muted-foreground hover:text-foreground data-[state=open]:text-foreground h-10 min-w-0 shrink gap-1.5 rounded-lg border px-2.5 font-medium shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 [&_svg]:size-4"
                data-testid="reasoning-controls-button"
                onBlur={() => {
                  tooltipAllowed.current = true;
                }}
                onPointerEnter={() => {
                  tooltipAllowed.current = true;
                }}
                type="button"
                variant="ghost">
                <BrainIcon className="shrink-0" />
                {chipText && <span className="max-w-24 truncate">{chipText}</span>}
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <DropdownMenuContent
            align="start"
            className="max-h-[60vh] w-60 max-w-[calc(100vw-20px)] overflow-y-auto"
            data-testid="reasoning-controls-menu"
            side="top">
            <DropdownMenuLabel className="flex items-center gap-2 px-2 pb-1 pt-1.5">
              <BrainIcon className="text-muted-foreground size-4" />
              {t('chat_reasoningOptions')}
            </DropdownMenuLabel>
            {rows.map(({ control, label, labels, selected }) => (
              <Fragment key={control.path}>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-muted-foreground px-2 pb-0.5 pt-1 text-xs font-medium">
                  {label}
                </DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  onValueChange={value => choose(control.path, control.values[Number(value)])}
                  value={String(selected)}>
                  {control.values.map((value, valueIndex) => (
                    <DropdownMenuRadioItem
                      key={formatReasoningValue(value)}
                      onSelect={event => event.preventDefault()}
                      value={String(valueIndex)}>
                      <span className="min-w-0 truncate">{labels[valueIndex]}</span>
                      {sameReasoningValue(value, control.default) && (
                        <span className="bg-muted text-muted-foreground ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px] leading-none">
                          {t('chat_reasoningDefault')}
                        </span>
                      )}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </Fragment>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <TooltipContent className="max-w-64 px-3 py-2" side="top">
          <div className="mb-1 font-medium">{t('chat_reasoningOptions')}</div>
          <dl className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 text-xs">
            {rows.map(({ control, label, labels, selected }) => (
              <Fragment key={control.path}>
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="text-right">{labels[selected]}</dd>
              </Fragment>
            ))}
          </dl>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

export { ReasoningControlsMenu };
export type { ReasoningControlsMenuProps };
