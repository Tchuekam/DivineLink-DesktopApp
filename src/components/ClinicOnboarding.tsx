import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ClinicSettingsPage } from "@/components/ClinicSettingsPage";
import { useLang } from "@/contexts/LangContext";
import { Stethoscope } from "lucide-react";

interface Props { open: boolean; onDone: () => void; }

export function ClinicOnboarding({ open, onDone }: Props) {
  const { lang } = useLang();
  const fr = lang === "fr";
  return (
    <Dialog open={open} onOpenChange={() => { /* must complete */ }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" onInteractOutside={e => e.preventDefault()}>
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Stethoscope className="w-5 h-5 text-primary" />
            <DialogTitle>{fr ? "Bienvenue sur DivineLink" : "Welcome to DivineLink"}</DialogTitle>
          </div>
          <DialogDescription>
            {fr
              ? "Configurez votre clinique pour commencer."
              : "Configure your clinic to get started."}
          </DialogDescription>
        </DialogHeader>
        <ClinicSettingsPage embedded onSaved={onDone} />
      </DialogContent>
    </Dialog>
  );
}
