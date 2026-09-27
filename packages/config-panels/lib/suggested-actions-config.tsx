import { getLocale, useT } from '@extension/i18n';
import {
  suggestedActionsStorage,
  getDefaultSuggestedActions,
  isDefaultActions,
  MAX_SUGGESTED_ACTIONS,
  SUGGESTED_ACTION_ICON_IDS,
} from '@extension/storage';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Separator,
  SuggestedActionIcon,
  Textarea,
} from '@extension/ui';
import {
  LightbulbIcon,
  PlusIcon,
  CheckCircle2Icon,
  Trash2Icon,
  RotateCcwIcon,
  ChevronUpIcon,
  ChevronDownIcon,
} from 'lucide-react';
import { nanoid } from 'nanoid';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SuggestedAction, SuggestedActionIconId } from '@extension/storage';

const SuggestedActionsConfig = () => {
  const t = useT();
  const [actions, setActions] = useState<SuggestedAction[] | null>(null);
  const [saved, setSaved] = useState(false);
  const [iconPickerActionId, setIconPickerActionId] = useState<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    suggestedActionsStorage.get().then(stored => {
      if (isDefaultActions(stored)) {
        setActions(getDefaultSuggestedActions(getLocale()));
      } else {
        setActions(stored);
      }
    });
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const triggerSaved = useCallback(() => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, []);

  const saveImmediate = useCallback(
    (next: SuggestedAction[]) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      const filtered = next.filter(a => a.label.trim() && a.prompt.trim());
      suggestedActionsStorage.set(filtered).then(triggerSaved);
    },
    [triggerSaved],
  );

  const saveDebounced = useCallback(
    (next: SuggestedAction[]) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        const filtered = next.filter(a => a.label.trim() && a.prompt.trim());
        suggestedActionsStorage.set(filtered).then(triggerSaved);
      }, 500);
    },
    [triggerSaved],
  );

  const handleLabelChange = useCallback(
    (id: string, label: string) => {
      setActions(prev => {
        if (!prev) return null;
        const next = prev.map(a => (a.id === id ? { ...a, label } : a));
        saveDebounced(next);
        return next;
      });
    },
    [saveDebounced],
  );

  const handlePromptChange = useCallback(
    (id: string, prompt: string) => {
      setActions(prev => {
        if (!prev) return null;
        const next = prev.map(a => (a.id === id ? { ...a, prompt } : a));
        saveDebounced(next);
        return next;
      });
    },
    [saveDebounced],
  );

  const handleIconChange = useCallback(
    (id: string, icon: SuggestedActionIconId) => {
      setActions(prev => {
        if (!prev) return null;
        const next = prev.map(action => (action.id === id ? { ...action, icon } : action));
        saveImmediate(next);
        return next;
      });
      setIconPickerActionId(null);
    },
    [saveImmediate],
  );

  const handleAdd = useCallback(() => {
    setActions(prev => {
      if (!prev || prev.length >= MAX_SUGGESTED_ACTIONS) return prev;
      const next = [...prev, { id: nanoid(), label: '', prompt: '', icon: 'sparkles' as const }];
      saveImmediate(next);
      return next;
    });
  }, [saveImmediate]);

  const handleRemove = useCallback(
    (id: string) => {
      setActions(prev => {
        if (!prev) return null;
        const next = prev.filter(a => a.id !== id);
        saveImmediate(next);
        return next;
      });
    },
    [saveImmediate],
  );

  const handleMoveUp = useCallback(
    (index: number) => {
      setActions(prev => {
        if (!prev || index <= 0) return prev;
        const next = [...prev];
        [next[index - 1], next[index]] = [next[index], next[index - 1]];
        saveImmediate(next);
        return next;
      });
    },
    [saveImmediate],
  );

  const handleMoveDown = useCallback(
    (index: number) => {
      setActions(prev => {
        if (!prev || index >= prev.length - 1) return prev;
        const next = [...prev];
        [next[index], next[index + 1]] = [next[index + 1], next[index]];
        saveImmediate(next);
        return next;
      });
    },
    [saveImmediate],
  );

  const handleReset = useCallback(() => {
    const next = [...getDefaultSuggestedActions(getLocale())];
    setActions(next);
    saveImmediate(next);
  }, [saveImmediate]);

  if (!actions) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LightbulbIcon className="size-5" />
          {t('actions_title')}
        </CardTitle>
        <CardDescription>{t('actions_description', String(MAX_SUGGESTED_ACTIONS))}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">{t('actions_heading')}</h3>
          <div className="flex gap-2">
            <Button onClick={handleReset} size="sm" variant="outline">
              <RotateCcwIcon className="mr-1 size-4" /> {t('actions_resetDefaults')}
            </Button>
            <Button
              disabled={actions.length >= MAX_SUGGESTED_ACTIONS}
              onClick={handleAdd}
              size="sm"
              variant="outline">
              <PlusIcon className="mr-1 size-4" /> {t('actions_addAction')}
            </Button>
          </div>
        </div>
        {actions.length === 0 && (
          <p className="text-muted-foreground text-sm">{t('actions_noActions')}</p>
        )}

        {actions.map((action, index) => (
          <div key={action.id}>
            {index > 0 && <Separator className="mb-4" />}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">
                  {t('actions_actionNumber', String(index + 1))}
                </Label>
                <div className="flex items-center gap-1">
                  <Button
                    disabled={index === 0}
                    onClick={() => handleMoveUp(index)}
                    size="icon"
                    title={t('actions_moveUp')}
                    variant="ghost">
                    <ChevronUpIcon className="size-4" />
                  </Button>
                  <Button
                    disabled={index === actions.length - 1}
                    onClick={() => handleMoveDown(index)}
                    size="icon"
                    title={t('actions_moveDown')}
                    variant="ghost">
                    <ChevronDownIcon className="size-4" />
                  </Button>
                  <Button
                    onClick={() => handleRemove(action.id)}
                    size="icon"
                    title={t('actions_remove')}
                    variant="ghost">
                    <Trash2Icon className="size-4 text-red-500" />
                  </Button>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  aria-label={t('actions_chooseIcon')}
                  className="border-border hover:bg-muted focus-visible:ring-ring rounded-xl border p-1 transition-colors focus-visible:outline-none focus-visible:ring-2"
                  onClick={() => setIconPickerActionId(action.id)}
                  title={t('actions_chooseIcon')}
                  type="button">
                  <SuggestedActionIcon className="size-9 rounded-lg" icon={action.icon} />
                </button>
                <Input
                  className="min-w-0 flex-1"
                  onChange={e => handleLabelChange(action.id, e.target.value)}
                  placeholder={t('actions_labelPlaceholder')}
                  value={action.label}
                />
              </div>
              <Textarea
                className="min-h-[60px] resize-none"
                onChange={e => handlePromptChange(action.id, e.target.value)}
                placeholder={t('actions_promptPlaceholder')}
                rows={2}
                value={action.prompt}
              />
            </div>
          </div>
        ))}

        {saved && (
          <span className="text-muted-foreground flex items-center gap-1 text-xs">
            <CheckCircle2Icon className="size-3" /> {t('common_saved')}
          </span>
        )}
        <Dialog
          onOpenChange={open => !open && setIconPickerActionId(null)}
          open={iconPickerActionId !== null}>
          <DialogContent className="max-w-sm rounded-2xl">
            <DialogHeader>
              <DialogTitle>{t('actions_chooseIcon')}</DialogTitle>
              <DialogDescription>{t('actions_iconHint')}</DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-4 gap-3" role="group">
              {SUGGESTED_ACTION_ICON_IDS.map((icon, index) => (
                <button
                  aria-label={`${t('actions_chooseIcon')} ${index + 1}`}
                  aria-pressed={
                    actions.find(action => action.id === iconPickerActionId)?.icon === icon
                  }
                  className="flex items-center justify-center rounded-xl border border-transparent p-2 transition-colors hover:border-slate-200 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 aria-pressed:border-blue-400 aria-pressed:bg-blue-50 dark:hover:border-slate-700 dark:hover:bg-slate-800 dark:aria-pressed:bg-blue-950/40"
                  key={icon}
                  onClick={() => iconPickerActionId && handleIconChange(iconPickerActionId, icon)}
                  type="button">
                  <SuggestedActionIcon icon={icon} />
                </button>
              ))}
            </div>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
};

export { SuggestedActionsConfig };
