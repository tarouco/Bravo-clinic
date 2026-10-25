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
