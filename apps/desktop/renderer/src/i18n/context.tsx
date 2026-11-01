import { createContext, useContext } from 'react';
import type { Locale } from '../api/contract';
import { translate, type MessageKey } from './messages';

export interface I18n {
  locale: Locale;
  timeZone: string;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
}

export function makeI18n(locale: Locale, timeZone: string): I18n {
  return { locale, timeZone, t: (key, vars) => translate(locale, key, vars) };
}

const I18nContext = createContext<I18n>(makeI18n('en-US', 'UTC'));
export const I18nProvider = I18nContext.Provider;
export const useI18n = () => useContext(I18nContext);
