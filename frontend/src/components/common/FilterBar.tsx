import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FilterState } from '../../types';

interface FilterBarProps {
  filters: FilterState;
  onChange: (f: FilterState) => void;
  availableYears?: string[];
}

const barStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 12,
  alignItems: 'flex-end',
  padding: '12px 16px',
  background: '#f8f9fa',
  border: '1px solid #dee2e6',
  borderRadius: 6,
  marginBottom: 20,
};

const labelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 13,
  color: '#495057',
};

const inputStyle: React.CSSProperties = {
  padding: '5px 10px',
  border: '1px solid #ced4da',
  borderRadius: 4,
  fontSize: 13,
  minWidth: 140,
};

const btnStyle = (variant: 'primary' | 'secondary'): React.CSSProperties => ({
  padding: '6px 16px',
  borderRadius: 4,
  border: variant === 'primary' ? 'none' : '1px solid #ced4da',
  background: variant === 'primary' ? '#1d3557' : '#fff',
  color: variant === 'primary' ? '#fff' : '#495057',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: variant === 'primary' ? 600 : 400,
});

const DEFAULT_YEARS = [
  '2017-2018','2018-2019','2019-2020','2020-2021',
  '2021-2022','2022-2023','2023-2024','2024-2025',
];

export default function FilterBar({ filters, onChange, availableYears }: FilterBarProps) {
  const { t } = useTranslation();
  const years = availableYears ?? DEFAULT_YEARS;
  const [local, setLocal] = useState<FilterState>(filters);

  const handleYearToggle = (year: string) => {
    const current = local.fiscal_year ?? [];
    const next = current.includes(year)
      ? current.filter(y => y !== year)
      : [...current, year];
    setLocal(prev => ({ ...prev, fiscal_year: next.length ? next : undefined }));
  };

  const handleApply = () => onChange(local);

  const handleClear = () => {
    const cleared: FilterState = {};
    setLocal(cleared);
    onChange(cleared);
  };

  return (
    <div style={barStyle}>
      <label style={labelStyle}>
        <span>{t('explorer.fiscalYear')}</span>
        <select
          multiple
          value={local.fiscal_year ?? []}
          onChange={e => {
            const selected = Array.from(e.target.selectedOptions).map(o => o.value);
            setLocal(prev => ({ ...prev, fiscal_year: selected.length ? selected : undefined }));
          }}
          style={{ ...inputStyle, height: 72 }}
        >
          {years.map(y => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </label>

      <label style={labelStyle}>
        <span>Region</span>
        <input
          type="text"
          value={local.region ?? ''}
          onChange={e => setLocal(prev => ({ ...prev, region: e.target.value || undefined }))}
          placeholder="Filter by region..."
          style={inputStyle}
        />
      </label>

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <button style={btnStyle('primary')} onClick={handleApply}>{t('common.apply')}</button>
        <button style={btnStyle('secondary')} onClick={handleClear}>{t('common.clear')}</button>
      </div>
    </div>
  );
}
