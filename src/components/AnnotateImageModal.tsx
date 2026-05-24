import React, { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useLang } from "@/contexts/LangContext";
import { Brush, Circle, ArrowRight, Eraser, Save } from "lucide-react";

type Tool = "freehand" | "circle" | "arrow";

interface Props {
  open: boolean;
  src: string | null;
  onClose: () => void;
  onSave: (dataUrl: string) => void;
}

export function AnnotateImageModal({ open, src, onClose, onSave }: Props) {
  const { t } = useLang();
  const baseRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [tool, setTool] = useState<Tool>("freehand");
  const [color, setColor] = useState("#ef4444");
  const drawingRef = useRef(false);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const snapshotRef = useRef<ImageData | null>(null);

  // Setup canvas when image loads
  useEffect(() => {
    if (!open || !src) return;
    const img = new Image();
    img.onload = () => {
      baseRef.current = img;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const max = 1024;
      const scale = Math.min(1, max / img.width);
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    };
    img.src = src;
  }, [open, src]);

  const getPos = (e: React.PointerEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const onDown = (e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    drawingRef.current = true;
    startRef.current = getPos(e);
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2, canvas.width / 250);
    ctx.lineCap = "round";
    if (tool === "freehand") {
      ctx.beginPath();
      ctx.moveTo(startRef.current.x, startRef.current.y);
    } else {
      snapshotRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height);
    }
  };

  const onMove = (e: React.PointerEvent) => {
    if (!drawingRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !startRef.current) return;
    const p = getPos(e);

    if (tool === "freehand") {
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    } else if (snapshotRef.current) {
      ctx.putImageData(snapshotRef.current, 0, 0);
      if (tool === "circle") {
        const dx = p.x - startRef.current.x;
        const dy = p.y - startRef.current.y;
        const r = Math.hypot(dx, dy);
        ctx.beginPath();
        ctx.arc(startRef.current.x, startRef.current.y, r, 0, Math.PI * 2);
        ctx.stroke();
      } else if (tool === "arrow") {
        drawArrow(ctx, startRef.current.x, startRef.current.y, p.x, p.y);
      }
    }
  };

  const onUp = () => {
    drawingRef.current = false;
    startRef.current = null;
    snapshotRef.current = null;
  };

  const reset = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !baseRef.current) return;
    ctx.drawImage(baseRef.current, 0, 0, canvas.width, canvas.height);
  };

  const save = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    onSave(canvas.toDataURL("image/jpeg", 0.85));
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("annotate.title")}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap gap-2 items-center">
          <Button size="sm" variant={tool === "freehand" ? "default" : "outline"} onClick={() => setTool("freehand")}>
            <Brush className="w-4 h-4 mr-1" />{t("annotate.draw")}
          </Button>
          <Button size="sm" variant={tool === "circle" ? "default" : "outline"} onClick={() => setTool("circle")}>
            <Circle className="w-4 h-4 mr-1" />{t("annotate.circle")}
          </Button>
          <Button size="sm" variant={tool === "arrow" ? "default" : "outline"} onClick={() => setTool("arrow")}>
            <ArrowRight className="w-4 h-4 mr-1" />{t("annotate.arrow")}
          </Button>
          <div className="flex items-center gap-2 ml-2">
            <Label className="text-xs">{t("annotate.color")}</Label>
            <input type="color" value={color} onChange={e => setColor(e.target.value)} className="w-9 h-9 rounded border" />
          </div>
          <Button size="sm" variant="outline" onClick={reset} className="ml-auto">
            <Eraser className="w-4 h-4 mr-1" />{t("annotate.clear")}
          </Button>
        </div>

        <div className="bg-muted rounded overflow-hidden">
          <canvas
            ref={canvasRef}
            className="w-full h-auto cursor-crosshair touch-none"
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerLeave={onUp}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          <Button onClick={save}><Save className="w-4 h-4 mr-1" />{t("annotate.save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function drawArrow(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  const head = Math.max(8, ctx.lineWidth * 4);
  const angle = Math.atan2(y2 - y1, x2 - x1);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - head * Math.cos(angle - Math.PI / 6), y2 - head * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(x2 - head * Math.cos(angle + Math.PI / 6), y2 - head * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fillStyle = ctx.strokeStyle as string;
  ctx.fill();
}
