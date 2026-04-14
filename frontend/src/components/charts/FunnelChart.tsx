interface FunnelStage {
  label: string;
  value: number;
  color: string;
}

interface RateItem {
  label: string;
  value: number;
}

interface FunnelChartProps {
  stages: FunnelStage[];
  rates?: RateItem[];
}

export default function FunnelChart({ stages, rates }: FunnelChartProps) {
  if (!stages || stages.length === 0) {
    return <p style={{ color: '#6c757d', fontSize: 13 }}>No data to display.</p>;
  }

  const maxVal = Math.max(...stages.map(s => s.value || 0));

  return (
    <div style={{ padding: '8px 0' }}>
      {stages.map((stage, i) => {
        const pct = maxVal > 0 ? (stage.value / maxVal) * 100 : 0;
        const indent = ((100 - pct) / 2);
        return (
          <div key={i} style={{ marginBottom: 6 }}>
            <div
              style={{
                marginLeft: `${indent}%`,
                marginRight: `${indent}%`,
                background: stage.color,
                borderRadius: 4,
                padding: '10px 16px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                transition: 'margin 0.3s',
              }}
            >
              <span style={{ fontWeight: 600, fontSize: 13, color: '#fff' }}>{stage.label}</span>
              <span style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>
                {stage.value.toLocaleString()}
              </span>
            </div>
            {i < stages.length - 1 && (
              <div
                style={{
                  margin: '0 auto',
                  width: 0,
                  height: 0,
                  borderLeft: '10px solid transparent',
                  borderRight: '10px solid transparent',
                  borderTop: `10px solid ${stage.color}`,
                  opacity: 0.5,
                  display: 'block',
                }}
              />
            )}
          </div>
        );
      })}

      {rates && rates.length > 0 && (
        <div style={{ display: 'flex', gap: 24, marginTop: 16, flexWrap: 'wrap' }}>
          {rates.map((r, i) => (
            <div
              key={i}
              style={{
                background: '#f1f3f5',
                borderRadius: 6,
                padding: '8px 16px',
                fontSize: 13,
              }}
            >
              <div style={{ color: '#6c757d', marginBottom: 2 }}>{r.label}</div>
              <div style={{ fontWeight: 700, fontSize: 18, color: '#1d3557' }}>
                {r.value != null ? `${r.value.toFixed(1)}%` : '—'}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
