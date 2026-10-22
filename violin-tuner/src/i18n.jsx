import { useInstrument } from './InstrumentContext.jsx';
import React, { createContext, useContext, useEffect, useState } from 'react';
import { initialLanguage, translate } from './translations.js';
const LanguageContext = createContext(null);
export function LanguageProvider({ children }) {
  const { instrument } = useInstrument();
  const [lang, setLang] = useState(() => {
    try {
      return initialLanguage(localStorage.getItem('arco-language'));
    } catch {
      return 'en';
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('arco-language', lang);
    } catch {}
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    document.title =
      lang === 'zh' ? `弦准 · ${instrument.zh}调音室` : `ARCO · ${instrument.en} Tuning Studio`;
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute(
        'content',
        lang === 'zh'
          ? '小提琴与吉他在线调音室，支持空弦调音、指位与手型练习。'
          : 'A violin and guitar tuning studio for open strings, finger patterns, and pitch practice.',
      );
  }, [lang, instrument.id]);
  return (
    <LanguageContext.Provider value={{ lang, setLang, t: (text) => translate(lang, text) }}>
      {children}
    </LanguageContext.Provider>
  );
}
export const useLanguage = () => useContext(LanguageContext);
