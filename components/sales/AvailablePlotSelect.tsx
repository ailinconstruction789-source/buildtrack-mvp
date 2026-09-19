'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { searchAvailablePlots, type InterestedPlot } from '@/lib/sales/plotAvailability';
import { loadAvailablePlots } from '@/lib/sales/plotAvailabilityClient';

interface AvailablePlotSelectProps {
  projectName?: string;
  value: InterestedPlot | null;
  onChange: (plot: InterestedPlot | null) => void;
  label?: string;
  disabled?: boolean;
  loadOptions?: (projectName: string) => Promise<InterestedPlot[]>;
}

/** The same searchable, optional selector is used by Inbound and Visit forms. */
export default function AvailablePlotSelect({
  projectName, value, onChange, label = 'แปลงที่เล็งไว้ (ถ้ามี)', disabled = false,
  loadOptions = loadAvailablePlots,
}: AvailablePlotSelectProps) {
  const id = useId();
  const [loaded, setLoaded] = useState<{ project: string; attempt: number; options: InterestedPlot[]; error: string }>({
    project: '', attempt: -1, options: [], error: '',
  });
  const [retry, setRetry] = useState(0);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const hasProject = !!projectName && projectName !== 'all';
  const current = loaded.project === projectName && loaded.attempt === retry;
  const error = current ? loaded.error : '';
  const selected = value?.project_name === projectName ? value : null;
  const results = useMemo(() => searchAvailablePlots(current ? loaded.options : [], query), [current, loaded.options, query]);

  useEffect(() => {
    let cancelled = false;
    if (!projectName || projectName === 'all') return;
    loadOptions(projectName).then(items => {
      if (!cancelled) setLoaded({ project: projectName, attempt: retry, options: items, error: '' });
    }).catch(() => {
      if (!cancelled) {
        setLoaded({ project: projectName, attempt: retry, options: [],
          error: 'ตรวจสอบแปลงว่างไม่ได้ กรุณาลองใหม่ หรือบันทึกโดยยังไม่เลือกแปลง' });
      }
    });
    return () => { cancelled = true; };
  }, [projectName, retry, loadOptions]);

  const choose = (plot: InterestedPlot) => {
    onChange(plot);
    setOpen(false);
    setQuery('');
  };
  const waiting = hasProject && !current;
  const listVisible = open && hasProject && !disabled;

  return (
    <div className="relative min-w-0">
      <label htmlFor={id} className="block text-slate-700 font-bold mb-1">{label}</label>
      <div className="flex gap-1">
        <input
          id={id} role="combobox" autoComplete="off" aria-autocomplete="list"
          aria-expanded={listVisible} aria-controls={`${id}-list`}
          aria-describedby={`${id}-help`}
          aria-activedescendant={listVisible && results[active] ? `${id}-option-${active}` : undefined}
          disabled={disabled || !hasProject}
          value={open ? query : selected ? selected.plot_name || selected.id : ''}
          placeholder={!hasProject ? 'เลือกโครงการก่อน' : waiting ? 'กำลังตรวจแปลงว่าง…' : 'ค้นหาเลขแปลง…'}
          onFocus={() => { setOpen(true); setQuery(''); setActive(0); }}
          onBlur={() => setOpen(false)}
          onChange={event => {
            setQuery(event.target.value); setOpen(true); setActive(0);
            // Typed free text must never retain a previously selected plot ID.
            if (value) onChange(null);
          }}
          onKeyDown={event => {
            if (event.key === 'Escape') { setOpen(false); return; }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault(); setOpen(true);
              setActive(index => Math.max(0, Math.min(results.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))));
            }
            if (event.key === 'Enter' && open) {
              event.preventDefault();
              if (!waiting && !error && results[active]) choose(results[active]);
            }
          }}
          className="w-full min-w-0 bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:opacity-60"
        />
        {selected && <button type="button" disabled={disabled} aria-label={`ล้าง${label}`}
          onClick={() => { onChange(null); setQuery(''); setOpen(false); }}
          className="px-2 text-slate-500 rounded-lg hover:bg-slate-100">×</button>}
      </div>
      <p id={`${id}-help`} className="text-[10px] text-slate-500 mt-1">เลือกได้เฉพาะแปลงว่าง การเล็งแปลงยังไม่ใช่การจอง</p>
      {error && hasProject && <div role="alert" className="text-xs text-rose-700 mt-1">
        {error} <button type="button" disabled={disabled || waiting} onClick={() => setRetry(n => n + 1)} className="underline">ลองใหม่</button>
      </div>}
      {listVisible && <div className="absolute z-30 mt-1 w-full rounded-xl bg-white border border-slate-200 shadow-xl max-h-48 overflow-y-auto">
        {waiting ? <p role="status" className="p-3 text-slate-500">กำลังตรวจแปลงว่าง…</p> :
          !error && results.length === 0 ? <p role="status" className="p-3 text-slate-500">ไม่พบแปลงว่างที่ตรงกับคำค้น</p> : null}
        <ul id={`${id}-list`} role="listbox" aria-label={label}>
          {!waiting && !error && results.map((plot, index) => (
            <li id={`${id}-option-${index}`} key={plot.id} role="option"
              aria-selected={selected?.id === plot.id}
              onPointerDown={event => event.preventDefault()}
              onClick={() => choose(plot)}
              onMouseEnter={() => setActive(index)}
              className={`p-3 cursor-pointer ${active === index ? 'bg-blue-50 text-blue-900' : 'text-slate-700'}`}>
              <span className="font-bold">{plot.plot_name || plot.id}</span>
              <span className="block text-[10px] text-slate-500">{plot.project_name}</span>
            </li>
          ))}
        </ul>
      </div>}
    </div>
  );
}
