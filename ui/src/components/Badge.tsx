interface BadgeProps {
  children: React.ReactNode;
  color?: 'blue' | 'purple' | 'gray';
}

const colors = {
  blue: { background: '#dbeafe', color: '#1e3a8a' },
  purple: { background: '#ede9fe', color: '#4c1d95' },
  gray: { background: '#f3f4f6', color: '#374151' },
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
