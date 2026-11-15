import { useEffect, useState } from 'react';
import { useStore } from '../api/store.js';

export function useNow(intervalMs = 1000) {
  const skew = useStore((s) => s.clockSkew);
  const [now, setNow] = useState(() => Date.now() + skew);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() + skew), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs, skew]);
  return now;
}

/** Draft text kept on this device until it is saved. */
export function useDraft(key) {
  const k = `orbital.draft.${key}`;
  const [v, setV] = useState(() => { try { return localStorage.getItem(k) ?? ''; } catch { return ''; } });
  useEffect(() => { try { setV(localStorage.getItem(k) ?? ''); } catch { setV(''); } }, [k]);
  const update = (nv) => {
    setV(nv);
    try { if (nv) localStorage.setItem(k, nv); else localStorage.removeItem(k); } catch { /* ignored */ }
  };
  return [v, update];
}
