import { settingsStorage } from '@extension/storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

type Theme = 'light' | 'dark' | 'system';

type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  /** The resolved theme after applying system preference. Always 'light' or 'dark'. */
  resolvedTheme: 'light' | 'dark';
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolveTheme(theme: Theme): 'light' | 'dark' {
  return theme === 'system' ? getSystemTheme() : theme;
}

function applyThemeClass(resolved: 'light' | 'dark') {
  const root = document.documentElement;
  root.classList.remove('light', 'dark');
  root.classList.add(resolved);
}

export function ThemeProvider({
  children,
  defaultTheme = 'system',
}: {
  children: ReactNode;
  defaultTheme?: Theme;
}) {
  const [theme, setThemeState] = useState<Theme>(defaultTheme);

  // Load persisted theme from settingsStorage on mount
  useEffect(() => {
    settingsStorage.get().then(settings => {
      if (settings?.theme) {
        setThemeState(settings.theme);
      }
    });

    // Subscribe to storage changes (e.g. from options page)
    const unsubscribe = settingsStorage.subscribe(() => {
      settingsStorage.get().then(settings => {
        if (settings?.theme) {
          setThemeState(settings.theme);
        }
      });
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // Apply the CSS class whenever theme changes
  const resolved = resolveTheme(theme);
  useEffect(() => {
    applyThemeClass(resolved);
  }, [resolved]);

  // Listen for system theme changes when theme is 'system'
  useEffect(() => {
    if (theme !== 'system') return;

    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      applyThemeClass(getSystemTheme());
    };
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [theme]);

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme);
    settingsStorage.set(prev => ({ ...prev, theme: newTheme }));
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, setTheme, resolvedTheme: resolved }),
    [theme, setTheme, resolved],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
