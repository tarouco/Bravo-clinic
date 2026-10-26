import { minuteToHHMM } from '@bravo/core';

/** 60 -> "1h", 90 -> "1h30", 150 -> "2h30", 30 -> "30min". */
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${String(rest)}min`;
  return rest === 0 ? `${String(hours)}h` : `${String(hours)}h${String(rest).padStart(2, '0')}`;
}

/** 1050, 1140 -> "17:30–19:00". */
export function formatMinuteRange(startMinute: number, endMinute: number): string {
  return `${minuteToHHMM(startMinute)}–${minuteToHHMM(endMinute)}`;
}

/** "2026-10-27" -> "27/10/2026". */
export function formatLocalDateBR(date: string): string {
  const [year = '', month = '', day = ''] = date.split('-');
  return `${day}/${month}/${year}`;
}

const WEEKDAY_NAMES = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'] as const;

/** [1..7] -> "Todos os dias", [1..5] -> "Seg a sex", [6, 7] -> "Sáb e dom"; "+ feriados" when applicable. */
export function formatWeekdays(weekdays: readonly number[], appliesOnHolidays: boolean): string {
  const sorted = [...weekdays].sort((a, b) => a - b);
  const name = (day: number) => WEEKDAY_NAMES[day - 1] ?? '';
  const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
  const first = sorted[0] ?? 1;
  const last = sorted[sorted.length - 1] ?? 1;
  const contiguous = sorted.length > 1 && last - first === sorted.length - 1;
  let label: string;
  if (sorted.length === 7) label = 'Todos os dias';
  else if (contiguous && sorted.length > 2) label = `${capital(name(first))} a ${name(last)}`;
  else
    label = capital(
      sorted
        .map(name)
        .join(', ')
        .replace(/, ([^,]*)$/, ' e $1'),
    );
  return appliesOnHolidays && sorted.length < 7 ? `${label} e feriados` : label;
}
