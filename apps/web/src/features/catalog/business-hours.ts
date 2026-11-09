import { minuteToHHMM, type Clinic } from '@bravo/core';

type Row = Clinic['businessHours'][number];

const SHORT: Record<Row['dayType'], string> = {
  mon: 'seg',
  tue: 'ter',
  wed: 'qua',
  thu: 'qui',
  fri: 'sex',
  sat: 'sáb',
  sun: 'dom',
  holiday: 'feriados',
};
const ORDER: Row['dayType'][] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun', 'holiday'];

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** ["mon".."fri"] -> "Seg a sex"; ["sat", "sun", "holiday"] -> "Sáb, dom e feriados". */
function daysLabel(days: Row['dayType'][]): string {
  const idx = days.map((d) => ORDER.indexOf(d));
  const weekdays = idx.filter((i) => i < 7);
  const contiguous =
    weekdays.length >= 3 && weekdays.every((i, n) => n === 0 || i === (weekdays[n - 1] ?? -2) + 1);
  const parts = contiguous
    ? [
        `${SHORT[ORDER[weekdays[0] ?? 0] ?? 'mon']} a ${SHORT[ORDER[weekdays.at(-1) ?? 0] ?? 'mon']}`,
      ]
    : weekdays.map((i) => SHORT[ORDER[i] ?? 'mon']);
  if (days.includes('holiday')) parts.push(SHORT.holiday);
  const text =
    parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} e ${parts.at(-1)}`;
  return capital(text);
}

/**
 * One-line summary of the 8 business-hours rows the admin configures: days with the same hours
 * are grouped, e.g. "Seg a sex 07:00–00:00 · Sáb, dom e feriados 09:00–00:00".
 */
export function businessHoursSummary(rows: readonly Row[]): string {
  const groups = new Map<string, Row['dayType'][]>();
  for (const day of ORDER) {
    const row = rows.find((r) => r.dayType === day);
    if (!row) continue;
    const key = row.isClosed
      ? 'fechado'
      : `${minuteToHHMM(row.openMinute)}–${minuteToHHMM(row.closeMinute)}`;
    groups.set(key, [...(groups.get(key) ?? []), day]);
  }
  return [...groups.entries()].map(([hours, days]) => `${daysLabel(days)} ${hours}`).join(' · ');
}
