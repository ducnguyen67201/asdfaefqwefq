interface EmptyStateProps {
  detail: string;
  icon: string;
  title: string;
}

export function EmptyState({ detail, icon, title }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <span className="empty-icon" aria-hidden="true">
        {icon}
      </span>
      <h3>{title}</h3>
      <p>{detail}</p>
    </div>
  );
}
