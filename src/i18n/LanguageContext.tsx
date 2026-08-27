import React from 'react';
import { Lang, translate } from './strings';

// Lightweight i18n context so deep components (Taskbar, Library, SystemMenu) can
// translate without prop-drilling. App owns the persisted `lang` and feeds it in;
// consumers call useI18n().t(key). `lang` is also exposed for the few spots that
// need to special-case (e.g. the brand wordmark, which shouldn't be doubled).
interface I18nValue {
  lang: Lang;
  t: (key: string) => string;
}

const LanguageContext = React.createContext<I18nValue>({
  lang: 'ru',
  t: (k) => k,
});

export const useI18n = () => React.useContext(LanguageContext);

export const LanguageProvider: React.FC<{ lang: Lang; children: React.ReactNode }> = ({ lang, children }) => {
  const value = React.useMemo<I18nValue>(
    () => ({ lang, t: (key: string) => translate(lang, key) }),
    [lang],
  );
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
};
