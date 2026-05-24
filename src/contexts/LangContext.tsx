import React, { createContext, useContext, useState, type ReactNode } from "react";
import { t, type Lang } from "@/lib/i18n";

interface LangCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string) => string;
}

const LangContext = createContext<LangCtx | null>(null);

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(() => {
    return (localStorage.getItem("divinelink-lang") as Lang) || "fr";
  });

  const handleSetLang = (l: Lang) => {
    setLang(l);
    localStorage.setItem("divinelink-lang", l);
  };

  const translate = (key: string) => t(key, lang);

  return (
    <LangContext.Provider value={{ lang, setLang: handleSetLang, t: translate }}>
      {children}
    </LangContext.Provider>
  );
}

export function useLang(): LangCtx {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error("useLang must be used within LangProvider");
  return ctx;
}
