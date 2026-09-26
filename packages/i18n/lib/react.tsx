import { setLocale, subscribe, t } from './i18n-runtime.js';
import { createContext, useContext, useEffect, useState } from 'react';
import type { LocaleCode } from './i18n-runtime.js';
import type { MessageKeyType } from './types.js';
import type { ReactNode } from 'react';

type TFunction = (key: MessageKeyType, substitutions?: string | string[]) => string;

type LocaleProviderProps = {
  locale: LocaleCode;
  children: ReactNode;
};

/** Version counter that increments on every locale change, used to trigger re-renders. */
let globalVersion = 0;

const LocaleContext = createContext(0);

const LocaleProvider = ({ locale, children }: LocaleProviderProps) => {
  const [version, setVersion] = useState(globalVersion);

  useEffect(() => {
    setLocale(locale).then(() => {
      globalVersion++;
      setVersion(globalVersion);
    });
  }, [locale]);

  useEffect(() => {
    const unsub = subscribe(() => {
      globalVersion++;
      setVersion(globalVersion);
    });
    return unsub;
  }, []);

  return <LocaleContext.Provider value={version}>{children}</LocaleContext.Provider>;
};

const useT = (): TFunction => {
  // Subscribe to context — triggers re-render when LocaleProvider updates version
  useContext(LocaleContext);
  return t;
};

export { LocaleProvider, useT, LocaleContext };
export type { TFunction };
