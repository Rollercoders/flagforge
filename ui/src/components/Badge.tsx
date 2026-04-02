interface BadgeProps {
  children: React.ReactNode;
  color?: 'blue' | 'purple' | 'gray';
}

const colors = {
  blue: { background: '#dbeafe', color: '#1d4ed8' },
  purple: { background: '#ede9fe', color: '#7c3aed' },
  gray: { background: '#f3f4f6', color: '#6b7280' },
};

export function Badge({ children, color = 'gray' }: BadgeProps) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 500,
        ...colors[color],
      }}
    >
      {children}
    </span>
  );
}
