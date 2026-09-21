interface MentionBadgeProps {
  mentioned: boolean;
}

export function MentionBadge({ mentioned }: MentionBadgeProps) {
  const color = mentioned ? "var(--status-good)" : "var(--text-muted)";
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
        {mentioned ? (
          <path
            d="M2 6.5L4.8 9L10 3"
            fill="none"
            stroke={color}
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : (
          <circle cx="6" cy="6" r="4" fill="none" stroke={color} strokeWidth="1.4" />
        )}
      </svg>
      {mentioned ? "Mentioned" : "Not mentioned"}
    </span>
  );
}
