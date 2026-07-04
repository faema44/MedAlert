export interface CyclePhaseInfo {
  dayInCycle: number; // 1-based; pode passar de cycleLengthDays se o ciclo atrasar
  phase: 'menstrual' | 'follicular' | 'ovulation' | 'luteal' | 'late';
  label: string;
  isFertile: boolean;
}

// Calcula em que dia e fase do ciclo a pessoa está, a partir do 1º dia informado.
// A fase lútea dura ~14 dias antes do próximo ciclo (mais estável que a folicular,
// que varia bastante) — por isso a ovulação é calculada de trás para frente
// (cycleLengthDays - 14), não como cycleLengthDays/2.
export function getCyclePhase(
  cycleStartDateIso: string,
  cycleLengthDays: number,
  periodLengthDays: number,
  today: Date = new Date(),
): CyclePhaseInfo {
  const start = new Date(cycleStartDateIso + 'T00:00:00');
  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const todayDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const daysSinceStart = Math.round((todayDay.getTime() - startDay.getTime()) / 86400000);
  const dayInCycle = daysSinceStart + 1;

  const ovulationDay = Math.max(periodLengthDays + 1, cycleLengthDays - 14);
  const fertileStart = Math.max(1, ovulationDay - 5);
  const fertileEnd = ovulationDay + 1;

  if (dayInCycle <= periodLengthDays) {
    return { dayInCycle, phase: 'menstrual', label: 'Menstrual', isFertile: false };
  }
  if (dayInCycle < fertileStart) {
    return { dayInCycle, phase: 'follicular', label: 'Folicular', isFertile: false };
  }
  if (dayInCycle <= fertileEnd) {
    return { dayInCycle, phase: 'ovulation', label: 'Ovulação (fértil)', isFertile: true };
  }
  if (dayInCycle <= cycleLengthDays) {
    return { dayInCycle, phase: 'luteal', label: 'Lútea (TPM)', isFertile: false };
  }
  return { dayInCycle, phase: 'late', label: 'Ciclo atrasado', isFertile: false };
}
