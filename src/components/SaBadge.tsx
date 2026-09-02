export function SaBadge({ onSa, handled, compact }: { onSa: boolean; handled?: boolean; compact?: boolean }) {
  if (onSa) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-full bg-teal-soft font-semibold text-teal ${
          compact ? "px-1.5 py-0.5 text-[10px]" : "px-2.5 py-1 text-[11px]"
        }`}
      >
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-teal" />
        {handled && !compact ? "Added on SA" : compact ? "On SA" : "Already on SA"}
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full bg-[#f8eee6] font-semibold text-accent ${
        compact ? "px-1.5 py-0.5 text-[10px]" : "px-2.5 py-1 text-[11px]"
      }`}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
      {compact ? "Missing" : "Missing from SA"}
    </span>
  );
}

export function CalendarLegend({ className = "" }: { className?: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-4 text-xs text-muted ${className}`}>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-sm bg-teal" />
        Official meeting already on SA
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-sm bg-accent" />
        Official meeting missing from SA
      </span>
      <span className="inline-flex items-center gap-1.5">
        Mark as on SA after you add it — counts in analytics
      </span>
    </div>
  );
}
