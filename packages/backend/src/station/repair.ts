/**
 * Health-aware repair crew recommendation (backend). Ported from the interface's src/lib/repair.js
 * and connected to the backend health reports. Each candidate gets a skill score (training for
 * this task) and a health score (how current findings affect this kind of work); some findings
 * block a task outright. Illustrative demo logic: the flight surgeon and flight director decide.
 */
import { CREW } from '@orbital/shared/crew';
import type { CrewMember, SkillId } from '@orbital/shared/types';
import type { HealthReport, Level } from '../health/engine';
import type { ComponentState, TaskDef } from './hardware';

const RANK: Record<Level, number> = { nominal: 0, nodata: 1, advisory: 1, warning: 2, critical: 3 };
export const TASK_LABEL: Record<string, string> = { EVA: 'Spacewalk (EVA)', IVA: 'Inside repair (IVA)', Robotics: 'Robotics' };
export const VERDICT_LABEL = { recommended: 'Recommended', precautions: 'Cleared with precautions', 'not-recommended': 'Not recommended', 'not-cleared': 'Not cleared' } as const;
export const VERDICT_TONE = { recommended: 'nominal', precautions: 'advisory', 'not-recommended': 'warning', 'not-cleared': 'critical' } as const;
type Verdict = keyof typeof VERDICT_LABEL;

const SKILL_LABEL: Record<SkillId, string> = {
  eva: 'spacewalk', robotics: 'robotic arm', electrical: 'electrical', thermal: 'thermal systems',
  lifeSupport: 'life support', mechanical: 'mechanical repair', medical: 'medical',
};
const EFFECT: Record<string, string> = {
  spo2: 'oxygen reserve during suit work', bodyTemp: 'heat tolerance', heartRate: 'exertion tolerance',
  bloodPressure: 'circulation under exertion', respiratoryRate: 'breathing reserve', fvc: 'breathing reserve',
  grip: 'hand fatigue in pressurized gloves', visualShift: 'fine visual work', sleepHours: 'alertness and error risk',
  sleepEfficiency: 'alertness', stress: 'decisions under pressure', radiation: 'extra radiation dose outside the hull',
  lumbarBmd: 'fracture risk under heavy loads', femoralBmd: 'fracture risk under heavy loads', quad: 'leg strength in foot restraints',
  standing: 'dizziness when changing posture', legVolume: 'fluid balance', fatigue: 'alertness',
};
const EFFECT_BY_TASK: Record<string, Record<string, string>> = {
  IVA: { spo2: 'stamina and concentration', grip: 'tool handling', heartRate: 'stamina' },
  Robotics: { spo2: 'concentration', heartRate: 'steady hand control', grip: 'hand controller use' },
};
const PRECAUTION: Record<string, string> = {
  spo2: 'Recheck SpO₂ before starting and stop if it drops.', bodyTemp: 'Recheck core temperature before starting.',
  heartRate: 'Watch heart rate on live telemetry during the task.', bloodPressure: 'Check blood pressure before the task.',
  respiratoryRate: 'Check breathing rate before starting.', fvc: 'Run a quick spirometry check before suit-up.',
  grip: 'Plan glove rest breaks every 45 minutes.', visualShift: 'Use magnified checklists and extra work lighting.',
  sleepHours: 'Schedule the task after a full sleep period.', sleepEfficiency: 'Avoid the end of a long shift.',
  stress: 'Brief with the behavioral health officer; keep the timeline loose.', radiation: 'Keep time outside short and log the extra dose.',
  lumbarBmd: 'Let the robotic arm move heavy parts; no manual lifting.', femoralBmd: 'Let the robotic arm move heavy parts; no manual lifting.',
  quad: 'Use foot restraints and plan rest breaks.', standing: 'Change position slowly and keep fluids up.', legVolume: 'Drink extra fluids beforehand.',
  fatigue: 'Schedule the task after rest.',
};
type Rule = { metric: string; block: Level | null; weight: number };
const PROFILES: Record<string, Rule[]> = {
  EVA: [
    { metric: 'spo2', block: 'warning', weight: 1.6 }, { metric: 'bodyTemp', block: 'warning', weight: 1 },
    { metric: 'heartRate', block: 'critical', weight: 1 }, { metric: 'bloodPressure', block: 'critical', weight: 1 },
    { metric: 'respiratoryRate', block: 'critical', weight: 0.8 }, { metric: 'fvc', block: 'critical', weight: 1 },
    { metric: 'grip', block: 'critical', weight: 1.4 }, { metric: 'visualShift', block: 'critical', weight: 1 },
    { metric: 'sleepHours', block: 'critical', weight: 1.2 }, { metric: 'stress', block: 'critical', weight: 1 },
    { metric: 'radiation', block: 'critical', weight: 1 }, { metric: 'lumbarBmd', block: null, weight: 0.9 },
    { metric: 'femoralBmd', block: null, weight: 0.6 }, { metric: 'quad', block: null, weight: 0.8 },
    { metric: 'standing', block: null, weight: 0.5 }, { metric: 'legVolume', block: null, weight: 0.3 },
  ],
  IVA: [
    { metric: 'spo2', block: 'critical', weight: 1 }, { metric: 'bodyTemp', block: 'warning', weight: 1 },
    { metric: 'heartRate', block: 'critical', weight: 0.5 }, { metric: 'bloodPressure', block: 'critical', weight: 0.6 },
    { metric: 'sleepHours', block: null, weight: 1 }, { metric: 'visualShift', block: null, weight: 0.8 },
    { metric: 'stress', block: null, weight: 0.8 }, { metric: 'grip', block: null, weight: 0.6 },
    { metric: 'standing', block: null, weight: 0.4 }, { metric: 'fvc', block: null, weight: 0.4 },
  ],
  Robotics: [
    { metric: 'spo2', block: 'critical', weight: 0.8 }, { metric: 'bodyTemp', block: 'warning', weight: 1 },
    { metric: 'sleepHours', block: 'critical', weight: 1.4 }, { metric: 'sleepEfficiency', block: null, weight: 0.8 },
    { metric: 'visualShift', block: 'critical', weight: 1.2 }, { metric: 'stress', block: 'critical', weight: 1.2 },
    { metric: 'heartRate', block: null, weight: 0.3 },
  ],
};
const PENALTY: Record<Level, number> = { nominal: 0, nodata: 6, advisory: 4, warning: 12, critical: 25 };
const SENSOR_METRICS = new Set(['spo2', 'heartRate', 'bloodPressure', 'bodyTemp', 'respiratoryRate']);

const joinList = (items: string[]) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

function scoreSkills(a: CrewMember, required: Record<string, number>) {
  let got = 0, total = 0;
  const strengths: string[] = [], gaps: string[] = [], partial: string[] = [];
  for (const [skill, need] of Object.entries(required)) {
    const have = a.skills[skill as SkillId] ?? 0;
    got += Math.min(have / need, 1) * need; total += need;
    const label = SKILL_LABEL[skill as SkillId] ?? skill;
    if (have >= need) strengths.push(label); else if (have <= need - 2) gaps.push(label); else partial.push(label);
  }
  return { score: total ? (got / total) * 100 : 100, strengths, gaps, partial };
}

export interface Candidate {
  crewId: string; name: string; role: string; photo: string; fitness: number; skillScore: number; healthScore: number;
  verdict: Verdict; verdictLabel: string; tone: string; cleared: boolean; pros: string[]; cons: string[]; blockers: string[]; precautions: string[];
}

export function evaluateCandidate(a: CrewMember, report: HealthReport, task: Pick<TaskDef, 'type' | 'skills'>): Candidate {
  const profile = PROFILES[task.type] ?? PROFILES.IVA;
  const byId = Object.fromEntries(report.metrics.map((m) => [m.id, m]));
  const pros: string[] = [], cons: string[] = [], precautions: string[] = [], blockers: string[] = [];
  let penalty = 0;
  if (task.type === 'EVA' && !a.eva.certified) blockers.push('Not certified for spacewalks.');
  if (task.type === 'EVA' && (task.skills.eva ?? 0) >= 3 && (a.skills.eva ?? 0) < 2)
    blockers.push('Spacewalk training is basic only; this repair needs an experienced spacewalker.');
  if (report.openIncidents.some((i) => i.urgency === 'urgent'))
    blockers.push(`Open urgent medical incident (${report.openIncidents.find((i) => i.urgency === 'urgent')!.id}).`);

  for (const rule of profile) {
    const m = byId[rule.metric];
    if (!m || m.status === 'nominal') continue;
    const effect = EFFECT_BY_TASK[task.type]?.[rule.metric] ?? EFFECT[rule.metric] ?? 'this task';
    if (m.status === 'nodata') {
      if (SENSOR_METRICS.has(rule.metric)) {
        const text = `No current ${m.label.toLowerCase()} reading (${effect})`;
        if (task.type === 'EVA' && rule.block) blockers.push(`${text}; a live reading is required before a spacewalk.`);
        else { penalty += PENALTY.nodata * rule.weight; cons.push(`${text}.`); precautions.push(`Take a manual ${m.label.toLowerCase()} reading before starting.`); }
      }
      continue;
    }
    const text = `${m.label} ${m.display} (${effect})`;
    const blocked = rule.block && RANK[m.status] >= RANK[rule.block];
    if (blocked) blockers.push(`${text}.`);
    else {
      penalty += PENALTY[m.status] * rule.weight;
      if (m.status !== 'advisory') { cons.push(`${text}.`); if (PRECAUTION[rule.metric]) precautions.push(PRECAUTION[rule.metric]); }
    }
  }
  const workload = report.psych.workloadScore ?? 0;
  if (workload >= 8.5) { penalty += 10; cons.push(`Workload is already very high (${workload.toFixed(1)}/10).`); precautions.push('Move other tasks off their schedule first.'); }
  else if (workload >= 7.5) penalty += 4;

  const skills = scoreSkills(a, task.skills);
  if (blockers.some((b) => b.startsWith('Spacewalk training'))) skills.gaps = skills.gaps.filter((g) => g !== SKILL_LABEL.eva);
  let skillScore = skills.score;
  if (task.type === 'EVA' && a.eva.hours >= 20) { skillScore = Math.min(100, skillScore + 5); pros.push(`${a.eva.hours} h of spacewalk experience over ${a.eva.count} EVAs.`); }
  if (skills.strengths.length) pros.unshift(`Fully trained in ${joinList(skills.strengths)}.`);
  if (skills.partial.length) cons.unshift(`Partly trained in ${joinList(skills.partial)}.`);
  if (skills.gaps.length) cons.unshift(`Limited ${joinList(skills.gaps)} training.`);

  const healthScore = Math.max(0, 100 - penalty);
  if (healthScore >= 85 && blockers.length === 0) pros.push('Health readings support this kind of work.');
  const fitness = Math.round(skillScore * 0.5 + healthScore * 0.5);
  let verdict: Verdict;
  if (blockers.length) verdict = 'not-cleared';
  else if (fitness >= 75 && cons.length <= 1) verdict = 'recommended';
  else if (fitness >= 55) verdict = 'precautions';
  else verdict = 'not-recommended';
  return {
    crewId: a.id, name: a.name, role: a.role, photo: a.photo,
    fitness: blockers.length ? Math.min(fitness, 35) : fitness, skillScore: Math.round(skillScore), healthScore: Math.round(healthScore),
    verdict, verdictLabel: VERDICT_LABEL[verdict], tone: VERDICT_TONE[verdict], cleared: verdict === 'recommended' || verdict === 'precautions',
    pros, cons: [...blockers, ...cons], blockers, precautions: [...new Set(precautions)],
  };
}

const ROLES: Record<string, { id: string; label: string }[]> = {
  EVA: [{ id: 'EV1', label: 'EV1 lead, outside' }, { id: 'EV2', label: 'EV2 buddy, outside' }],
  IVA: [{ id: 'LEAD', label: 'Lead technician' }, { id: 'ASSIST', label: 'Assistant' }],
  Robotics: [{ id: 'ARM', label: 'Arm operator' }, { id: 'BACKUP', label: 'Backup operator' }],
};

export function recommendCrew(component: ComponentState, reports: Record<string, HealthReport>) {
  const task = component.task;
  if (!task) return null;
  const ranked = CREW.map((a) => evaluateCandidate(a, reports[a.id], task))
    .sort((x, y) => Number(y.cleared) - Number(x.cleared) || y.fitness - x.fitness);
  const cleared = ranked.filter((c) => c.cleared);
  const team: { role: string; roleLabel: string; candidate: Candidate }[] = [];
  ROLES[task.type].forEach((role, i) => { if (cleared[i]) team.push({ role: role.id, roleLabel: role.label, candidate: cleared[i] }); });
  if (task.type === 'EVA') {
    const used = new Set(team.map((t) => t.candidate.crewId));
    const iv = CREW.filter((a) => !used.has(a.id)).map((a) => evaluateCandidate(a, reports[a.id], { type: 'IVA', skills: { eva: 2, robotics: 2 } }))
      .filter((c) => c.cleared).sort((x, y) => y.fitness - x.fitness)[0];
    if (iv) team.push({ role: 'IV', roleLabel: 'IV support, inside', candidate: iv });
  }
  const needed = ROLES[task.type].length;
  let note = '';
  if (cleared.length === 0) note = 'No crew member is cleared for this task right now. Postpone it and review with the flight surgeon.';
  else if (task.type === 'EVA' && cleared.length < 2) note = 'Only one crew member is cleared to go outside. A spacewalk needs two, so postpone it or ask the flight surgeon to review.';
  else if (cleared.length < needed) note = 'Only one crew member is cleared, so this task runs without a backup.';
  const precautions = [...new Set(team.flatMap((t) => t.candidate.precautions))].slice(0, 4);
  return {
    componentId: component.id, task: { ...task, typeLabel: TASK_LABEL[task.type] }, ranked,
    team: team.map((t) => ({ role: t.role, roleLabel: t.roleLabel, crewId: t.candidate.crewId, name: t.candidate.name, verdict: t.candidate.verdict, verdictLabel: t.candidate.verdictLabel, tone: t.candidate.tone, fitness: t.candidate.fitness, pros: t.candidate.pros, cons: t.candidate.cons })),
    note, complete: team.length >= needed, precautions,
  };
}
export type Recommendation = NonNullable<ReturnType<typeof recommendCrew>>;
