interface ProgressBarProps {
  completed: number;
  total: number;
}

export function ProgressBar({ completed, total }: ProgressBarProps) {
  const pct = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;
  return (
    <div className="flex flex-col gap-1.5" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className="flex justify-between text-xs" style={{ color: "var(--text-secondary)" }}>
        <span>Running prompts...</span>
        <span className="tabular">
          {completed} / {total} ({pct}%)
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full" style={{ background: "var(--meter-track)" }}>
        <div
          className="h-full rounded-full transition-[width] duration-300 ease-out"
          style={{ width: `${pct}%`, background: "var(--series-1)" }}
        />
      </div>
    </div>
  );
}
