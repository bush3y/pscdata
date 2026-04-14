import { useState, useRef, useEffect } from 'react';

interface Props {
  value: string;
  onChange: (val: string) => void;
  options: string[];
  placeholder?: string;
}

export default function FilterCombobox({ value, onChange, options, placeholder }: Props) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = value.trim()
    ? options.filter(o => o.toLowerCase().includes(value.toLowerCase()))
    : options;

  useEffect(() => {
    setHighlighted(-1);
  }, [value]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const select = (opt: string) => {
    onChange(opt);
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') setOpen(true);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted(h => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted(h => Math.max(h - 1, 0));
    } else if (e.key === 'Enter' && highlighted >= 0) {
      e.preventDefault();
      select(filtered[highlighted]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <input
        type="text"
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        style={{
          padding: '5px 10px',
          border: '1px solid #ced4da',
          borderRadius: open && filtered.length > 0 ? '4px 4px 0 0' : 4,
          fontSize: 13,
          width: '100%',
          boxSizing: 'border-box',
        }}
      />
      {open && filtered.length > 0 && (
        <ul style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          margin: 0,
          padding: 0,
          listStyle: 'none',
          background: '#fff',
          border: '1px solid #ced4da',
          borderTop: 'none',
          borderRadius: '0 0 4px 4px',
          maxHeight: 220,
          overflowY: 'auto',
          zIndex: 100,
          boxShadow: '0 4px 8px rgba(0,0,0,0.08)',
        }}>
          {filtered.map((opt, i) => (
            <li
              key={opt}
              onMouseDown={() => select(opt)}
              onMouseEnter={() => setHighlighted(i)}
              style={{
                padding: '6px 10px',
                fontSize: 13,
                cursor: 'pointer',
                background: i === highlighted ? '#e8f0fe' : '#fff',
                borderBottom: i < filtered.length - 1 ? '1px solid #f1f3f4' : 'none',
              }}
            >
              {opt}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
