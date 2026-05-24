import React, { useState } from "react";

interface Props {
  before: string;
  after: string;
  beforeLabel?: string;
  afterLabel?: string;
}

/** Simple before/after slider using a clip-path on the after image. */
export function BeforeAfterCompare({ before, after, beforeLabel = "Before", afterLabel = "After" }: Props) {
  const [pct, setPct] = useState(50);

  return (
    <div className="space-y-2">
      <div className="relative w-full overflow-hidden rounded-lg bg-muted select-none">
        <img src={before} alt={beforeLabel} className="block w-full h-auto" />
        <img
          src={after}
          alt={afterLabel}
          className="absolute inset-0 w-full h-full object-cover"
          style={{ clipPath: `inset(0 0 0 ${pct}%)` }}
          draggable={false}
        />
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-primary pointer-events-none"
          style={{ left: `${pct}%` }}
        />
        <span className="absolute top-2 left-2 text-xs bg-background/80 px-2 py-0.5 rounded">{beforeLabel}</span>
        <span className="absolute top-2 right-2 text-xs bg-background/80 px-2 py-0.5 rounded">{afterLabel}</span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={pct}
        onChange={e => setPct(Number(e.target.value))}
        className="w-full"
        aria-label="Compare slider"
      />
    </div>
  );
}
