import React, { useEffect, useMemo, useState } from "react";
import { useLang } from "@/contexts/LangContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { MessageCircle, Send, Copy, Smartphone, WifiOff, BellRing, BellOff } from "lucide-react";
import { toast } from "sonner";
import { isPushSupported, isSubscribed, enablePushNotifications, disablePushNotifications } from "@/lib/pushNotifications";
import { useAuth } from "@/contexts/AuthContext";
import { getClinicId } from "@/lib/clinicSettings";

export interface ReminderContext {
  patientName: string;
  patientPhone: string;
  doctorName: string;
  doctorPhone: string;
  date: string;
  time: string;
  reason: string;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  context: ReminderContext | null;
}

type Channel = "whatsapp" | "sms";
type Target = "patient" | "doctor";

interface Templates {
  patient: string;
  doctor: string;
}

const STORAGE_KEY = "reminder.templates.v1";

const DEFAULTS: Record<"en" | "fr", Templates> = {
  en: {
    patient:
      "Hello {patientName}, this is a reminder of your appointment on {date} at {time} with Dr. {doctorName}. Reason: {reason}. Reply to confirm. — DivineLink",
    doctor:
      "Reminder Dr. {doctorName}: appointment with {patientName} on {date} at {time}. Reason: {reason}.",
  },
  fr: {
    patient:
      "Bonjour {patientName}, rappel de votre rendez-vous le {date} à {time} avec Dr. {doctorName}. Motif : {reason}. Merci de confirmer. — DivineLink",
    doctor:
      "Rappel Dr. {doctorName} : rendez-vous avec {patientName} le {date} à {time}. Motif : {reason}.",
  },
};

function loadTemplates(lang: "en" | "fr"): Templates {
  try {
    const raw = localStorage.getItem(STORAGE_KEY + "." + lang);
    if (raw) return JSON.parse(raw);
  } catch {}
  return DEFAULTS[lang];
}

function saveTemplates(lang: "en" | "fr", t: Templates) {
  localStorage.setItem(STORAGE_KEY + "." + lang, JSON.stringify(t));
}

function render(template: string, ctx: ReminderContext): string {
  return template
    .replace(/\{patientName\}/g, ctx.patientName || "—")
    .replace(/\{patientPhone\}/g, ctx.patientPhone || "—")
    .replace(/\{doctorName\}/g, ctx.doctorName || "—")
    .replace(/\{doctorPhone\}/g, ctx.doctorPhone || "—")
    .replace(/\{date\}/g, ctx.date || "—")
    .replace(/\{time\}/g, ctx.time || "—")
    .replace(/\{reason\}/g, ctx.reason || "—");
}

function normalizePhone(p: string): string {
  return p.replace(/[^\d+]/g, "").replace(/^\+/, "");
}

export function RemindersPanel({ open, onOpenChange, context }: Props) {
  const { t, lang } = useLang() as any;
  const { user } = useAuth();
  const effectiveLang: "en" | "fr" = lang === "fr" ? "fr" : "en";
  const [templates, setTemplates] = useState<Templates>(() => loadTemplates(effectiveLang));
  const [target, setTarget] = useState<Target>("patient");
  const [channel, setChannel] = useState<Channel>("whatsapp");
  const [online, setOnline] = useState<boolean>(typeof navigator !== "undefined" ? navigator.onLine : true);
  const [pushOn, setPushOn] = useState(false);

  useEffect(() => {
    if (isPushSupported()) isSubscribed().then(setPushOn);
  }, [open]);

  useEffect(() => {
    setTemplates(loadTemplates(effectiveLang));
  }, [effectiveLang]);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  const preview = useMemo(() => {
    if (!context) return "";
    return render(target === "patient" ? templates.patient : templates.doctor, context);
  }, [templates, target, context]);

  const phone = context
    ? normalizePhone(target === "patient" ? context.patientPhone : context.doctorPhone)
    : "";

  const updateTemplate = (which: Target, value: string) => {
    const next = { ...templates, [which]: value };
    setTemplates(next);
    saveTemplates(effectiveLang, next);
  };

  const resetDefaults = () => {
    const next = DEFAULTS[effectiveLang];
    setTemplates(next);
    saveTemplates(effectiveLang, next);
    toast.success(t("reminder.reset"));
  };

  const togglePush = async () => {
    if (pushOn) {
      await disablePushNotifications();
      setPushOn(false);
      toast.success(t("push.disabled"));
    } else {
      const clinicId = getClinicId();
      const result = await enablePushNotifications(user?.id || 0, user?.name || "", clinicId);
      if (result.success) {
        setPushOn(true);
        toast.success(t("push.enabled"));
      } else {
        toast.error(result.error === "Permission denied or subscription failed"
          ? t("push.permissionDenied")
          : result.error === "Push notifications not supported in this browser"
          ? t("push.notSupported")
          : t("push.registerFailed"));
      }
    }
  };

  const send = () => {
    if (!context) return;
    if (!phone) {
      toast.error(t("wa.noPhone"));
      return;
    }
    const url =
      channel === "whatsapp"
        ? `https://wa.me/${phone}?text=${encodeURIComponent(preview)}`
        : `sms:${phone}?body=${encodeURIComponent(preview)}`;
    window.open(url, "_blank");
  };

  const copyMessage = async () => {
    try {
      await navigator.clipboard.writeText(preview);
      toast.success(t("reminder.copied"));
    } catch {
      toast.error(t("reminder.copyFail"));
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <MessageCircle className="w-5 h-5 text-success" />
            {t("reminder.title")}
          </SheetTitle>
          <SheetDescription>{t("reminder.subtitle")}</SheetDescription>
        </SheetHeader>

        <div className="mt-4 flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="gap-1">
            {online ? <Smartphone className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            {online ? t("reminder.online") : t("reminder.offline")}
          </Badge>
          <Button size="sm" variant="ghost" onClick={resetDefaults} className="ml-auto">
            {t("reminder.reset")}
          </Button>
        </div>

        {isPushSupported() && (
          <div className="mt-3 border rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {pushOn ? <BellRing className="w-4 h-4 text-primary" /> : <BellOff className="w-4 h-4 text-muted-foreground" />}
                <div>
                  <p className="text-sm font-medium">{t("push.autoReminder")}</p>
                  <p className="text-xs text-muted-foreground">{t("push.autoReminderHint")}</p>
                </div>
              </div>
              <Button size="sm" variant={pushOn ? "default" : "outline"} onClick={togglePush}>
                {pushOn ? t("push.subscribed") : t("push.enable")}
              </Button>
            </div>
          </div>
        )}

        <Tabs value={target} onValueChange={(v) => setTarget(v as Target)} className="mt-4">
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="patient">{t("wa.patient")}</TabsTrigger>
            <TabsTrigger value="doctor">{t("wa.doctor")}</TabsTrigger>
          </TabsList>

          <TabsContent value="patient" className="space-y-3">
            <div>
              <Label>{t("reminder.template")}</Label>
              <Textarea
                value={templates.patient}
                onChange={(e) => updateTemplate("patient", e.target.value)}
                rows={5}
                className="font-mono text-xs"
              />
            </div>
          </TabsContent>
          <TabsContent value="doctor" className="space-y-3">
            <div>
              <Label>{t("reminder.template")}</Label>
              <Textarea
                value={templates.doctor}
                onChange={(e) => updateTemplate("doctor", e.target.value)}
                rows={5}
                className="font-mono text-xs"
              />
            </div>
          </TabsContent>
        </Tabs>

        <div className="mt-3 text-xs text-muted-foreground">
          {t("reminder.placeholders")}:{" "}
          <code className="text-foreground">
            {"{patientName} {doctorName} {date} {time} {reason} {patientPhone} {doctorPhone}"}
          </code>
        </div>

        <div className="mt-5 space-y-2">
          <Label>{t("reminder.channel")}</Label>
          <div className="flex gap-2">
            <Button
              type="button"
              variant={channel === "whatsapp" ? "default" : "outline"}
              size="sm"
              onClick={() => setChannel("whatsapp")}
              className="flex-1"
            >
              WhatsApp
            </Button>
            <Button
              type="button"
              variant={channel === "sms" ? "default" : "outline"}
              size="sm"
              onClick={() => setChannel("sms")}
              className="flex-1"
            >
              SMS
            </Button>
          </div>
        </div>

        <div className="mt-5">
          <Label>{t("reminder.preview")}</Label>
          <div className="mt-2 rounded-lg border bg-muted/30 p-3">
            <div className="rounded-2xl bg-success/10 border border-success/20 px-3 py-2 text-sm whitespace-pre-wrap break-words">
              {preview || t("common.noData")}
            </div>
            <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
              <span>{phone ? `+${phone}` : t("wa.noPhone")}</span>
              <span>{preview.length} {t("reminder.chars")}</span>
            </div>
          </div>
        </div>

        <div className="mt-5 flex gap-2">
          <Button variant="outline" onClick={copyMessage} className="flex-1">
            <Copy className="w-4 h-4 mr-2" /> {t("reminder.copy")}
          </Button>
          <Button onClick={send} disabled={!phone} className="flex-1">
            <Send className="w-4 h-4 mr-2" /> {t("reminder.send")}
          </Button>
        </div>

        {!online && (
          <p className="mt-3 text-xs text-muted-foreground">
            {t("reminder.offlineHint")}
          </p>
        )}
      </SheetContent>
    </Sheet>
  );
}
