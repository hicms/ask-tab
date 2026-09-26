import { useT, LOCALE_OPTIONS } from '@extension/i18n';
import { askSessionStorage, settingsStorage } from '@extension/storage';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@extension/ui';
import { CheckCircle2Icon, Loader2Icon, LogOutIcon, SettingsIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { LocaleCode } from '@extension/i18n';
import type { AskSession, SettingsData } from '@extension/storage';

const Settings = () => {
  const t = useT();
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [saved, setSaved] = useState(false);
  const [session, setSession] = useState<AskSession | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    settingsStorage.get().then(setSettings);
  }, []);

  useEffect(() => {
    askSessionStorage.get().then(setSession);
    return askSessionStorage.subscribe(() => {
      askSessionStorage.get().then(setSession);
    });
  }, []);

  const handleSignOut = useCallback(async () => {
    setSigningOut(true);
    try {
      await chrome.runtime.sendMessage({ type: 'ASK_LOGOUT' });
    } finally {
      setSigningOut(false);
    }
  }, []);

  const triggerSaved = useCallback(() => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, []);

  const applyTheme = useCallback((theme: string) => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else if (theme === 'light') {
      root.classList.remove('dark');
    } else {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.classList.toggle('dark', prefersDark);
    }
  }, []);

  const handleThemeChange = useCallback(
    async (value: string) => {
      const updated = settings ? { ...settings, theme: value as SettingsData['theme'] } : null;
      setSettings(updated);
      applyTheme(value);
      if (updated) {
        await settingsStorage.set(updated);
        triggerSaved();
      }
    },
    [applyTheme, settings, triggerSaved],
  );

  const handleLocaleChange = useCallback(
    async (value: string) => {
      const updated = settings ? { ...settings, locale: value as LocaleCode } : null;
      setSettings(updated);
      if (updated) {
        await settingsStorage.set(updated);
        triggerSaved();
      }
    },
    [settings, triggerSaved],
  );

  if (!settings) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SettingsIcon className="size-5" />
          {t('settings_title')}
        </CardTitle>
        <CardDescription>{t('settings_description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <h3 className="text-sm font-medium">{t('account_title')}</h3>
          <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2.5">
            <span className="text-muted-foreground truncate text-sm" data-testid="account-email">
              {session ? session.email : t('account_signedOut')}
            </span>
            {session && (
              <Button disabled={signingOut} onClick={handleSignOut} size="sm" variant="outline">
                {signingOut ? (
                  <Loader2Icon className="mr-1 size-4 animate-spin" />
                ) : (
                  <LogOutIcon className="mr-1 size-4" />
                )}
                {t('account_signOut')}
              </Button>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="text-sm font-medium">{t('settings_appearance')}</h3>

          <div className="grid gap-2">
            <Label htmlFor="theme">{t('settings_theme')}</Label>
            <Select onValueChange={handleThemeChange} value={settings.theme}>
              <SelectTrigger id="theme">
                <SelectValue placeholder={t('settings_theme')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="system">{t('settings_themeSystem')}</SelectItem>
                <SelectItem value="light">{t('settings_themeLight')}</SelectItem>
                <SelectItem value="dark">{t('settings_themeDark')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="locale">{t('settings_language')}</Label>
            <Select onValueChange={handleLocaleChange} value={settings.locale ?? 'auto'}>
              <SelectTrigger id="locale">
                <SelectValue placeholder={t('settings_language')} />
              </SelectTrigger>
              <SelectContent>
                {LOCALE_OPTIONS.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.value === 'auto' ? t('settings_languageAuto') : opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {saved && (
          <span className="text-muted-foreground flex items-center gap-1 text-xs">
            <CheckCircle2Icon className="size-3" /> {t('common_saved')}
          </span>
        )}
      </CardContent>
    </Card>
  );
};

export { Settings };
