interface ChartCardProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

const cardStyle: React.CSSProperties = {
  border: '1px solid #dee2e6',
  borderRadius: 8,
  padding: '20px 24px',
  background: '#fff',
  boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
  marginBottom: 24,
};

const titleStyle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 600,
  color: '#111827',
  margin: '0 0 4px 0',
  letterSpacing: '-0.01em',
};

const subtitleStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#6b7280',
  margin: '0 0 16px 0',
};

export default function ChartCard({ title, subtitle, children }: ChartCardProps) {
  return (
    <div style={cardStyle}>
      <h3 style={titleStyle}>{title}</h3>
      {subtitle && <p style={subtitleStyle}>{subtitle}</p>}
      {children}
    </div>
  );
}
