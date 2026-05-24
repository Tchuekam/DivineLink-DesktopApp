import React, { useRef, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Mic, MicOff } from "lucide-react";
import { useLang } from "@/contexts/LangContext";
import { toast } from "sonner";

interface Props extends Omit<React.ComponentProps<typeof Textarea>, "onChange" | "value"> {
  value: string;
  onChange: (v: string) => void;
}

/**
 * Reusable textarea with an embedded mic button for speech-to-text dictation.
 * Recognition language follows the current app language (fr-FR / en-US).
 * Transcripts are APPENDED to existing content (never overwrite).
 */
export function VoiceTextarea({ value, onChange, className, ...rest }: Props) {
  const { lang } = useLang();
  const [recording, setRecording] = useState(false);
  const recRef = useRef<any>(null);

  const toggle = () => {
    const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      toast.error(lang === "fr"
        ? "Reconnaissance vocale non supportée. Utilisez Chrome."
        : "Voice recognition not supported. Please use Chrome.");
      return;
    }
    if (recording) {
      recRef.current?.stop();
      setRecording(false);
      return;
    }
    const r = new SR();
    r.lang = lang === "fr" ? "fr-FR" : "en-US";
    r.continuous = true;
    r.interimResults = false;
    r.onresult = (e: any) => {
      const txt = Array.from(e.results as ArrayLike<any>)
        .map((res: any) => res[0].transcript)
        .join(" ")
        .trim();
      if (txt) onChange(value ? value + " " + txt : txt);
    };
    r.onend = () => setRecording(false);
    r.onerror = () => setRecording(false);
    try { r.start(); recRef.current = r; setRecording(true); }
    catch { setRecording(false); }
  };

  return (
    <div className="relative">
      <Textarea
        {...rest}
        value={value}
        onChange={e => onChange(e.target.value)}
        className={`pr-10 ${className || ""}`}
      />
      <button
        type="button"
        onClick={toggle}
        title={recording ? (lang === "fr" ? "Arrêter" : "Stop") : (lang === "fr" ? "Dicter" : "Dictate")}
        className={`absolute top-1.5 right-1.5 w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
          recording ? "bg-destructive text-destructive-foreground animate-pulse" : "bg-muted hover:bg-accent text-muted-foreground"
        }`}
      >
        {recording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
      </button>
    </div>
  );
}
