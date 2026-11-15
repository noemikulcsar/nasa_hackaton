import { useEffect, useRef, useState } from 'react';
import { STATUS_LABEL, initials } from '../lib/format.js';

// Photo placeholder: drop files into public/assets/photos using the names in shared/crew.ts.
// Until a photo exists, the crew member's initials show instead.
export function Avatar({ src, name, size = 48 }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="avatar" style={{ '--avatar-size': `${size}px` }}>
      <span className="avatar-fallback" aria-hidden="true">{initials(name)}</span>
      {!failed && <img src={src} alt="" onError={() => setFailed(true)} />}
    </span>
  );
}

export function StatusPill({ status, label }) {
  return <span className={`badge ${status}`}>{label ?? STATUS_LABEL[status]}</span>;
}

export function StatusDot({ status }) {
  return <span className={`dot ${status}`} title={STATUS_LABEL[status]} aria-label={STATUS_LABEL[status]} role="img" />;
}

export function Sparkline({ values = [] }) {
  if (values.length < 2) return null;
  const width = 120, height = 26;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const d = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${((i / (values.length - 1)) * width).toFixed(1)},${(height - ((v - min) / span) * (height - 4) - 2).toFixed(1)}`).join(' ');
  return (
    <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

/** Prov(enance) chip: simulated, real data, demo. */
export function Prov({ kind, children }) {
  return <span className={`badge tag prov-${kind}`}>{children}</span>;
}

/**
 * Single-series chart for the Vitals and Record pages. Line (or bars), optional shaded normal band,
 * optional dashed "usual" line, crosshair tooltip on hover. Data comes from the server.
 */
export function LineChart({ points, band, usual, unit = '', height = 150, bars = false, xLabel, decimals = 1, emptyText = 'No data in this window' }) {
  const [hover, setHover] = useState(null);
  const [width, setWidth] = useState(600);
  const boxRef = useRef(null);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [points?.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!points || points.length === 0) return <div className="chart-empty">{emptyText}</div>;
  const W = width, H = height, PL = 40, PR = 10, PT = 10, PB = 22;
  const ys = points.map((p) => p.y).concat(band ?? []).concat(usual != null ? [usual] : []);
  let min = Math.min(...ys), max = Math.max(...ys);
  if (bars) min = Math.min(0, min);
  if (max - min < 1e-9) { min -= 1; max += 1; }
  const pad = (max - min) * 0.1; if (!bars) min -= pad; max += pad;
  const xs = points.map((p) => p.x);
  const x0 = Math.min(...xs), x1 = Math.max(...xs) === x0 ? x0 + 1 : Math.max(...xs);
  const inset = bars ? Math.max(6, (W - PL - PR) / points.length / 2) : 0; // keep bars inside the plot area
  const sx = (x) => PL + inset + ((x - x0) / (x1 - x0)) * (W - PL - PR - 2 * inset);
  const sy = (y) => H - PB - ((y - min) / (max - min)) * (H - PT - PB);
  const ticks = [min + (max - min) * 0.1, (min + max) / 2, max - (max - min) * 0.1];
  const bw = Math.max(4, Math.min(48, (W - PL - PR) / points.length - 6));
  const h = hover != null ? points[hover] : null;
  return (
    <div className="chart" ref={boxRef}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={`Chart, ${points.length} values in ${unit}`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const x = ((e.clientX - r.left) / r.width) * W;
          let best = 0;
          points.forEach((p, i) => { if (Math.abs(sx(p.x) - x) < Math.abs(sx(points[best].x) - x)) best = i; });
          setHover(best);
        }}>
        {band && <rect x={PL} width={W - PL - PR} y={sy(Math.min(band[1], max))} height={Math.max(1, sy(Math.max(band[0], min)) - sy(Math.min(band[1], max)))} className="chart-band" />}
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={PL} x2={W - PR} y1={sy(t)} y2={sy(t)} className="chart-grid" />
            <text x={PL - 6} y={sy(t) + 4} textAnchor="end" className="chart-axis">{t.toFixed(decimals)}</text>
          </g>
        ))}
        {usual != null && <line x1={PL} x2={W - PR} y1={sy(usual)} y2={sy(usual)} className="chart-usual" vectorEffect="non-scaling-stroke" />}
        {bars
          ? points.map((p, i) => <rect key={i} x={sx(p.x) - bw / 2} width={bw} y={sy(p.y)} height={Math.max(1, sy(min) - sy(p.y))} rx={3} className={`chart-bar ${p.hl ? 'hl' : ''} ${hover === i ? 'hov' : ''}`} />)
          : <path d={points.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join('')} className="chart-line" vectorEffect="non-scaling-stroke" />}
        {!bars && points.length < 40 && points.map((p, i) => <circle key={i} cx={sx(p.x)} cy={sy(p.y)} r={hover === i ? 4.5 : 3} className="chart-dot" vectorEffect="non-scaling-stroke" />)}
        {h && <line x1={sx(h.x)} x2={sx(h.x)} y1={PT} y2={H - PB} className="chart-cross" vectorEffect="non-scaling-stroke" />}
        {h && !bars && <circle cx={sx(h.x)} cy={sy(h.y)} r={5} className="chart-dot hov" />}
        <text x={PL} y={H - 5} className="chart-axis">{points[0].label}</text>
        <text x={W - PR} y={H - 5} textAnchor="end" className="chart-axis">{points[points.length - 1].label}</text>
      </svg>
      <div className="chart-tip" aria-live="polite">
        {h ? <><b>{h.y} {unit}</b> <span className="muted">{h.label}{h.note ? `, ${h.note}` : ''}</span></> : <span className="muted">{xLabel ?? 'Hover the chart for values'}</span>}
      </div>
    </div>
  );
}

export function Drawer({ title, subtitle, onClose, children, testId, wide, fill, actions, size }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className={`drawer ${wide ? 'wide' : ''} ${size ?? ''}`} role="dialog" aria-label={title} data-testid={testId}>
        <header className="drawer-head">
          <div>
            {subtitle && <p>{subtitle}</p>}
            <h2>{title}</h2>
          </div>
          {actions}
          <button type="button" className="icon-btn" onClick={onClose} aria-label={`Close ${title}`}>×</button>
        </header>
        <div className={`drawer-body ${fill ? 'fill' : ''}`}>{children}</div>
      </aside>
    </>
  );
}

export function Modal({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

/** Small line icons (stroke), drawn inline so the console needs no icon package. */
const ICONS = {
  chat: 'M4 5h16v11H9l-5 4z',
  users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a6 6 0 0 1 12 0v1M16 3.5a4 4 0 0 1 0 7.5M22 21v-1a6 6 0 0 0-4-5.6',
  station: 'M3 12h18M12 3v18M6 6h4v4H6zM14 14h4v4h-4zM14 6h4v4h-4zM6 14h4v4H6z',
  book: 'M4 4h6a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4zM20 4h-6a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h7z',
  alert: 'M12 3 2 20h20zM12 10v4M12 17v.5',
};
export function Icon({ name }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}
