import { useState, useRef, useEffect } from 'react';

interface Props {
  value: string[];
  onChange: (val: string[]) => void;
  options: string[];
  placeholder?: string;
}

export default function MultiSelectCombobox({ value, onChange, options, placeholder }: Props) {
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = options.filter(
    o => !value.includes(o) && o.toLowerCase().includes(input.toLowerCase()),
  );

  useEffect(() => { setHighlighted(-1); }, [input]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setInput('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const add = (opt: string) => {
    onChange([...value, opt]);
    setInput('');
    setHighlighted(-1);
    inputRef.current?.focus();
  };

  const remove = (opt: string) => {
    onChange(value.filter(v => v !== opt));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && input === '' && value.length > 0) {
      remove(value[value.length - 1]);
      return;
    }
    if (!open || filtered.length === 0) {
      if (e.key === 'ArrowDown') setOpen(true);
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
      add(filtered[highlighted]);
    } else if (e.key === 'Escape') {
      setOpen(false);
      setInput('');
    }
  };

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <div
        onClick={() => { setOpen(true); inputRef.current?.focus(); }}
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 4,
          padding: '4px 8px',
          border: '1px solid #ced4da',
          borderRadius: open && filtered.length > 0 ? '4px 4px 0 0' : 4,
          background: '#fff',
          minHeight: 32,
          cursor: 'text',
        }}
      >
        {value.map(v => (
          <span
            key={v}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              background: '#e8f0fe',
              color: '#1d3557',
              borderRadius: 3,
              padding: '1px 6px',
              fontSize: 12,
              fontWeight: 500,
              whiteSpace: 'nowrap',
            }}
          >
            {v}
            <button
              onMouseDown={e => { e.stopPropagation(); remove(v); }}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                padding: 0, lineHeight: 1, color: '#1d3557', fontSize: 14,
              }}
            >×</button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={e => { setInput(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={value.length === 0 ? placeholder : ''}
          style={{
            border: 'none',
            outline: 'none',
            fontSize: 13,
            flex: '1 1 80px',
            minWidth: 60,
            padding: '1px 2px',
            background: 'transparent',
          }}
        />
      </div>

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
              onMouseDown={() => add(opt)}
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
