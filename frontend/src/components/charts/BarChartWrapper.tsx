import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

interface BarDef {
  key: string;
  name: string;
  color: string;
}

interface BarChartWrapperProps {
  data: Record<string, unknown>[];
  xKey: string;
  bars: BarDef[];
  yLabel?: string;
}

export default function BarChartWrapper({ data, xKey, bars, yLabel }: BarChartWrapperProps) {
  if (!data || data.length === 0) {
    return <p style={{ color: '#6c757d', fontSize: 13 }}>No data to display.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={320}>
      <BarChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 60 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e9ecef" />
        <XAxis
          dataKey={xKey}
          tick={{ fontSize: 11 }}
          angle={-35}
          textAnchor="end"
          interval={0}
        />
        <YAxis
          tick={{ fontSize: 12 }}
          label={yLabel ? { value: yLabel, angle: -90, position: 'insideLeft', style: { fontSize: 11 } } : undefined}
        />
        <Tooltip />
        <Legend verticalAlign="bottom" />
        {bars.map(b => (
          <Bar key={b.key} dataKey={b.key} name={b.name} fill={b.color} radius={[3, 3, 0, 0]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
