let counter = 0;
/** Unique, roughly time-ordered event id. */
export const newId = (prefix = 'ev') => `${prefix}_${Date.now().toString(36)}_${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
