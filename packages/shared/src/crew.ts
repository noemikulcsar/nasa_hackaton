import type { CrewMember } from './types';

// FICTIONAL crew profiles. Each profile is given the real, anonymised lab tests of one
// Inspiration4 subject from NASA OSDR (OSD-575) of the same sex.
export const CREW: CrewMember[] = [
  {
    id: 'voss', name: 'Elena Voss', role: 'Flight Engineer', roleShort: 'FE', isMedicalOfficer: false,
    photo: '/assets/photos/astronaut_elena_voss.jpg', osdrSubject: 'C002', sex: 'F', age: 42,
    bio: 'Flight engineer, thermal and mechanical systems specialist.',
    dateOfBirth: '1984-03-17', bloodType: 'O+',
    mission: { name: 'Expedition 74', orbit: 'Low Earth orbit, 408 km', module: 'Destiny Laboratory', missionDay: 86, durationDays: 180 },
    feeling: 'Focused and in good spirits. Mornings feel heavy in the legs, and the ARED sessions are getting harder.',
    skills: { eva: 3, robotics: 2, electrical: 2, thermal: 3, lifeSupport: 2, mechanical: 3, medical: 1 },
    eva: { certified: true, hours: 38.5, count: 6 },
  },
  {
    id: 'okafor', name: 'Amara Okafor', role: 'Mission Specialist', roleShort: 'MS', isMedicalOfficer: false,
    photo: '/assets/photos/astronaut_amara_okafor.jpg', osdrSubject: 'C003', sex: 'F', age: 47,
    bio: 'Mission specialist, robotics lead in the Kibo laboratory.',
    dateOfBirth: '1979-11-02', bloodType: 'A-',
    mission: { name: 'Expedition 74', orbit: 'Low Earth orbit, 408 km', module: 'Kibo laboratory', missionDay: 40, durationDays: 210 },
    feeling: 'Running on fumes. My sleep schedule keeps slipping, and my vision looks a little blurred when I wake up.',
    skills: { eva: 1, robotics: 3, electrical: 2, thermal: 1, lifeSupport: 2, mechanical: 1, medical: 1 },
    eva: { certified: true, hours: 6.3, count: 1 },
  },
  {
    id: 'marchetti', name: 'Lucas Marchetti', role: 'Commander', roleShort: 'CDR', isMedicalOfficer: false,
    photo: '/assets/photos/astronaut_lucas_marchetti.jpg', osdrSubject: 'C001', sex: 'M', age: 51,
    bio: 'Expedition commander, experienced spacewalker.',
    dateOfBirth: '1975-06-21', bloodType: 'B+',
    mission: { name: 'Expedition 74', orbit: 'Low Earth orbit, 408 km', module: 'Cupola and Destiny Laboratory', missionDay: 86, durationDays: 180 },
    feeling: "Holding it together, but the schedule is relentless. My heart rate spikes during docking drills, and I can't switch off at night.",
    skills: { eva: 3, robotics: 3, electrical: 2, thermal: 2, lifeSupport: 1, mechanical: 2, medical: 1 },
    eva: { certified: true, hours: 44.0, count: 7 },
  },
  {
    id: 'menon', name: 'Ravi Menon', role: 'Medical Officer', roleShort: 'CMO', isMedicalOfficer: true,
    photo: '/assets/photos/astronaut_ravi_menon.jpg', osdrSubject: 'C004', sex: 'M', age: 38,
    bio: 'Crew medical officer; the link to the flight surgeon on the ground.',
    dateOfBirth: '1988-01-09', bloodType: 'AB+',
    mission: { name: 'Expedition 74', orbit: 'Low Earth orbit, 408 km', module: 'Harmony node, crew medical station', missionDay: 126, durationDays: 200 },
    feeling: 'Feeling good overall. I get lightheaded when I stand up after sitting for a while, and I want the team to check it.',
    skills: { eva: 1, robotics: 1, electrical: 1, thermal: 1, lifeSupport: 3, mechanical: 2, medical: 3 },
    eva: { certified: true, hours: 0, count: 0 },
  },
];

export const CREW_BY_ID = Object.fromEntries(CREW.map((c) => [c.id, c])) as Record<string, CrewMember>;
