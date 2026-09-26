import '@src/Options.css';
import { CONFIG_TAB_GROUPS, ConfigPanelContent } from '@extension/config-panels';
import { LocaleProvider, useT } from '@extension/i18n';
import { withErrorBoundary, withSuspense } from '@extension/shared';
import { settingsStorage } from '@extension/storage';
import { ScrollArea, Toaster, ErrorDisplay, LoadingSpinner, cn } from '@extension/ui';
import { useEffect, useState } from 'react';
import type { ConfigTabId } from '@extension/config-panels';
import type { LocaleCode } from '@extension/i18n';

const OptionsContent = () => {
  const t = useT();
  const [activeTab, setActiveTab] = useState<ConfigTabId>('general');

  return (
    <div className="bg-background text-foreground flex h-dvh flex-col">
      {/* Header */}
      <div className="border-b border-gray-200 px-6 py-4 dark:border-gray-800">
        <h1 className="text-2xl font-bold">{t('optionsPage_title')}</h1>
      </div>

      {/* Sidebar + Content */}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* Sidebar — horizontal on mobile, vertical on md+ */}
        <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-gray-200 px-2 py-2 md:w-[220px] md:flex-col md:gap-0 md:overflow-x-visible md:border-b-0 md:border-r md:px-3 md:py-4 dark:border-gray-800">
          {CONFIG_TAB_GROUPS.map(group => (
            <div key={group.label} className="contents md:mb-4 md:block">
              <div className="text-muted-foreground hidden px-3 text-[11px] font-medium uppercase tracking-wider md:mb-1 md:block">
                {group.label}
              </div>
              {group.tabs.map(tab => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400'
                        : 'text-muted-foreground hover:bg-muted'
                    }`}>
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="whitespace-nowrap">{tab.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Content area */}
        <ScrollArea className="min-h-0 flex-1">
          <div
            className={cn(
              'mx-auto space-y-6 px-4 py-6',
              activeTab === 'agents' ? 'max-w-5xl' : 'max-w-2xl',
            )}>
            <ConfigPanelContent activeTab={activeTab} />
          </div>
        </ScrollArea>
      </div>

      <Toaster />
    </div>
  );
};

const Options = () => {
  const [locale, setLocale] = useState<LocaleCode>('auto');

  // Apply theme and locale on mount
  useEffect(() => {
    settingsStorage.get().then(settings => {
      const root = document.documentElement;
      if (settings.theme === 'dark') {
        root.classList.add('dark');
      } else if (settings.theme === 'system') {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        root.classList.toggle('dark', prefersDark);
      }
      setLocale((settings.locale ?? 'auto') as LocaleCode);
    });

    const unsub = settingsStorage.subscribe(() => {
      settingsStorage.get().then(settings => {
        setLocale((settings.locale ?? 'auto') as LocaleCode);
      });
    });
    return unsub;
  }, []);

  return (
    <LocaleProvider locale={locale}>
      <OptionsContent />
    </LocaleProvider>
  );
};

export default withErrorBoundary(withSuspense(Options, <LoadingSpinner />), ErrorDisplay);
