import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

interface SeriesDef {
  key: string;
  name: string;
  color: string;
}

interface TimeSeriesChartProps {
  data: Record<string, number | string>[];
  series: SeriesDef[];
  xKey?: string;
  yLabel?: string;
  height?: number;
}

export default function TimeSeriesChart({
  data,
  series,
  xKey = 'fiscal_year',
  yLabel,
  height = 300,
}: TimeSeriesChartProps) {
  if (!data || data.length === 0) {
    return <p style={{ color: '#6c757d', fontSize: 13 }}>No data to display.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e9ecef" />
        <XAxis dataKey={xKey} tick={{ fontSize: 12 }} />
        <YAxis
          tick={{ fontSize: 12 }}
          label={yLabel ? { value: yLabel, angle: -90, position: 'insideLeft', style: { fontSize: 11 } } : undefined}
        />
        <Tooltip />
        <Legend />
        {series.map(s => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.name}
            stroke={s.color}
            strokeWidth={2}
            dot={{ r: 4 }}
            activeDot={{ r: 6 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
