import { daysInMonth, weekdayIndex } from "@/lib/dates";
import type { DayCounts } from "@/lib/types";

const SHORT = ["S", "M", "T", "W", "T", "F", "S"];
const LONG = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function cellTone(counts?: DayCounts): string {
  if (!counts) return "text-muted";
  if (counts.missing > 0 && counts.onSa > 0) return "bg-[#f4ece0] text-foreground";
  if (counts.missing > 0) return "bg-[#f8eee6] text-accent";
  if (counts.onSa > 0 || (counts.saMeetings || 0) > 0) return "bg-teal-soft text-teal";
  return "text-muted";
}

export function MonthGrid({
  year,
  month,
  days,
  selected,
  onSelect,
  compact,
}: {
  year: number;
  month: number;
  days: Record<string, DayCounts>;
  selected?: string;
  onSelect?: (iso: string) => void;
  compact?: boolean;
}) {
  const n = daysInMonth(year, month);
  const pad = weekdayIndex(year, month, 1);
  const cells: Array<{ day: number | null; iso: string }> = [];
  for (let i = 0; i < pad; i++) cells.push({ day: null, iso: "" });
  for (let d = 1; d <= n; d++) {
    const iso = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    cells.push({ day: d, iso });
  }
  while (cells.length % 7 !== 0) cells.push({ day: null, iso: "" });

  const labels = compact ? SHORT : LONG;
  const today = todayKey();

  return (
    <div className={compact ? "select-none" : "select-none"}>
      <div className="grid grid-cols-7">
        {labels.map((label, i) => (
          <div
            key={`${label}-${i}`}
            className={`text-center font-medium uppercase tracking-wide text-muted ${
              compact ? "pb-1 text-[9px]" : "pb-2 text-[11px]"
            }`}
          >
            {label}
          </div>
        ))}
        {cells.map((cell, i) => {
          if (!cell.day) {
            return <div key={`empty-${i}`} className={compact ? "h-6" : "min-h-16"} />;
          }
          const counts = days[cell.iso];
          const isSelected = selected === cell.iso;
          const isToday = cell.iso === today;
          const clickable = Boolean(onSelect);
          const className = [
            "relative flex flex-col items-center justify-start rounded-md transition-colors",
            compact ? "h-6 text-[10px]" : "min-h-16 p-1 text-sm",
            cellTone(counts),
            isSelected ? "ring-2 ring-teal" : "",
            isToday && !isSelected ? "ring-1 ring-border" : "",
            clickable ? "cursor-pointer hover:ring-1 hover:ring-teal/50" : "",
          ].join(" ");

          const inner = (
            <>
              <span className={compact ? "leading-6" : "font-medium"}>{cell.day}</span>
              {!compact && counts && (counts.onSa > 0 || counts.missing > 0) && (
                <span className="mt-auto flex gap-0.5 pb-0.5">
                  {counts.onSa > 0 && <span className="h-1.5 w-1.5 rounded-full bg-teal" />}
                  {counts.missing > 0 && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
                </span>
              )}
              {compact && counts && (counts.onSa > 0 || counts.missing > 0) && (
                <span className="absolute bottom-0.5 left-1/2 flex -translate-x-1/2 gap-px">
                  {counts.onSa > 0 && <span className="h-1 w-1 rounded-full bg-teal" />}
                  {counts.missing > 0 && <span className="h-1 w-1 rounded-full bg-accent" />}
                </span>
              )}
            </>
          );

          if (clickable) {
            return (
              <button
                key={cell.iso}
                type="button"
                className={className}
                onClick={() => onSelect?.(cell.iso)}
                aria-label={`${cell.iso}${counts ? `, ${counts.onSa + counts.missing} events` : ""}`}
              >
                {inner}
              </button>
            );
          }
          return (
            <div key={cell.iso} className={className}>
              {inner}
            </div>
          );
        })}
      </div>
    </div>
  );
}
