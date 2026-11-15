// Display helpers only. No health or station logic lives in the browser.

export const STATUS_LABEL = { nominal: 'Normal', advisory: 'Check', warning: 'Warning', critical: 'Critical', nodata: 'No data' };
export const STATUS_RANK = { nominal: 0, nodata: 1, advisory: 2, warning: 3, critical: 4 };
export const ACTIVITY = { sleep: 'sleep', rest: 'rest', work: 'work', exercise: 'exercise' };
export const REGION_ORDER = ['head', 'chest', 'pelvis', 'arms', 'hands', 'legs', 'feet'];
export const REGION_LABEL = { head: 'Head', chest: 'Chest', pelvis: 'Pelvis', arms: 'Arms', hands: 'Hands', legs: 'Legs', feet: 'Feet' };

export const fmtTime = (ts) => new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
export const fmtDateTime = (ts) => new Date(ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
export function fmtAge(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h} h${m % 60 ? ` ${m % 60} min` : ''}` : `${Math.round(h / 24)} days`;
}
export function ageOn(iso, now = new Date()) {
  const dob = new Date(`${iso}T00:00:00Z`);
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const md = now.getUTCMonth() - dob.getUTCMonth();
  if (md < 0 || (md === 0 && now.getUTCDate() < dob.getUTCDate())) age -= 1;
  return age;
}
export const formatDate = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
export const initials = (name) => name.split(' ').map((p) => p[0]).slice(0, 2).join('');
