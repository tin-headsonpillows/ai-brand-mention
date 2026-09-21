interface StatTileProps {
  label: string;
  value: string;
  sublabel?: string;
}

export function StatTile({ label, value, sublabel }: StatTileProps) {
  return (
    <div
      className="flex flex-col gap-1 rounded-lg border p-4"
      style={{ borderColor: "var(--border-hairline)", background: "var(--surface-1)" }}
    >
      <span className="text-sm" style={{ color: "var(--text-secondary)" }}>
        {label}
      </span>
      <span className="text-3xl font-semibold" style={{ color: "var(--text-primary)" }}>
        {value}
      </span>
      {sublabel ? (
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          {sublabel}
        </span>
      ) : null}
    </div>
  );
}
