import React from "react";
import { useLang } from "@/contexts/LangContext";
import { Button } from "@/components/ui/button";
import { Globe } from "lucide-react";

export function LangToggle() {
  const { lang, setLang } = useLang();
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => setLang(lang === "en" ? "fr" : "en")}
      className="gap-1.5"
    >
      <Globe className="w-4 h-4" />
      {lang === "en" ? "FR" : "EN"}
    </Button>
  );
}
