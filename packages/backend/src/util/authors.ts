import type { Author } from '@orbital/shared/types';
import { CREW_BY_ID } from '@orbital/shared/crew';

/** Author of automatic readings (the wearable vital-sign sensor of a crew member). */
export const sensorAuthor = (astronautId: string): Author => ({
  id: `vitals-${astronautId}`, name: `Vital-sign sensor (${CREW_BY_ID[astronautId].name.split(' ')[0]})`, kind: 'sensor',
});
/** Author of an entry made by a crew member. */
export const crewAuthor = (id: string): Author => ({ id, name: CREW_BY_ID[id].name, kind: 'crew' });
