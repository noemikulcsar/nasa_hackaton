import type { RegionId } from './types';

/** Body regions, the same as the regions of the animated 3D astronaut (7 regions). */
export interface RegionDef {
  id: RegionId;
  /** Short name, for example "Chest" */
  label: string;
  /** Panel title, for example "Chest and heart" */
  title: string;
  hotkey: string;
  description: string;
  modelIds: string[];
}

export const REGIONS: RegionDef[] = [
  { id: 'head', label: 'Head', title: 'Head and eyes', hotkey: '1', description: 'Sleep, stress, vision and neurological symptoms.', modelIds: ['head'] },
  { id: 'chest', label: 'Chest', title: 'Chest and heart', hotkey: '2', description: 'Heart rate, blood oxygen, blood pressure, breathing and core temperature.', modelIds: ['chest'] },
  { id: 'pelvis', label: 'Pelvis', title: 'Pelvis and bone', hotkey: '3', description: 'Bone density, radiation dose and metabolic blood tests.', modelIds: ['pelvis'] },
  { id: 'arms', label: 'Arms', title: 'Arms', hotkey: '4', description: 'Resistive exercise (ARED) that protects muscle and bone.', modelIds: ['arms'] },
  { id: 'hands', label: 'Hands', title: 'Hands', hotkey: '5', description: 'Grip strength, important for work in pressurized gloves.', modelIds: ['hands'] },
  { id: 'legs', label: 'Legs', title: 'Legs', hotkey: '6', description: 'Leg muscle size, fluid shifts and daily exercise.', modelIds: ['legs'] },
  { id: 'feet', label: 'Feet', title: 'Feet and standing', hotkey: '7', description: 'Standing tolerance (dizziness when changing posture).', modelIds: ['feet'] },
];

export const REGION_BY_ID = Object.fromEntries(REGIONS.map((r) => [r.id, r])) as Record<RegionId, RegionDef>;

export function regionFromModelId(modelId: string | undefined | null): RegionId | 'whole_body' | null {
  if (!modelId) return null;
  if (modelId === 'whole_body') return 'whole_body';
  const r = REGIONS.find((d) => d.modelIds.includes(modelId));
  return r ? r.id : null;
}
