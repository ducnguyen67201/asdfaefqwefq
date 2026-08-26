import type { ReactNode } from 'react';

interface SummaryCardProps {
  foot: string;
  footKind?: 'default' | 'good' | 'warning';
  label: string;
  value: ReactNode;
}

export function SummaryCard({
  foot,
  footKind = 'default',
  label,
  value,
}: SummaryCardProps) {
  return (
    <article className="summary-card">
      <span className="summary-label">{label}</span>
      <strong>{value}</strong>
      <span
        className={`summary-foot${footKind === 'default' ? '' : ` summary-foot--${footKind}`}`}
      >
        {foot}
      </span>
    </article>
  );
}
