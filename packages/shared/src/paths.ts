import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Absolute path of the shared reference data folder (labs.json, hardware.json). */
export const SHARED_DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data');
export const sharedDataFile = (name: string) => path.join(SHARED_DATA_DIR, name);
