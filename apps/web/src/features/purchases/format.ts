import { formatBRL, minuteToHHMM, utcToLocal, weekdayOf, type LocalDate } from '@bravo/core';
import { formatLocalDateBR } from '../../lib/format';
import type { PackageOffer } from './types';

// pt-BR text helpers of the receita screens (REC-143, REC-155).

/** 750 -> "12h 30min", 1200 -> "20h", 45 -> "45min", 0 -> "0min". */
export function formatBalance(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${String(rest)}min`;
  return rest === 0 ? `${String(hours)}h` : `${String(hours)}h ${String(rest)}min`;
}

/** 78 -> "78 min", 1122 -> "1.122 min"; used by debit previews and the extrato. */
export function formatMinutes(minutes: number): string {
  return `${minutes.toLocaleString('pt-BR')} min`;
}

const MINUS = '−';

/** Signed minutes with a real minus sign and thousands separator: -78 -> "−78 min", 1200 -> "+1.200 min". */
export function formatSignedMinutes(minutes: number): string {
  const sign = minutes < 0 ? MINUS : '+';
  return `${sign}${Math.abs(minutes).toLocaleString('pt-BR')} min`;
}

/** 20h as "20 horas", 1h as "1 hora"; a fractional hour falls back to "12h 30min". */
export function formatIncludedHours(minutes: number): string {
  if (minutes % 60 !== 0) return formatBalance(minutes);
  const hours = minutes / 60;
  return `${String(hours)} ${hours === 1 ? 'hora' : 'horas'}`;
}

const PERIOD_LABELS: Record<PackageOffer['period'], string> = {
  monthly: 'mensal',
  bimonthly: 'bimestral',
  quarterly: 'trimestral',
};

/** "mensal", "bimestral" or "trimestral". */
export function periodLabel(period: PackageOffer['period']): string {
  return PERIOD_LABELS[period];
}

const WEEKDAY_NAMES = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'] as const;

/** [1..5] -> "Seg–Sex", [6,7] -> "Sáb–Dom", [1,3,5] -> "Seg, Qua, Sex"; ISO weekdays 1..7. */
export function formatWeekdayRange(weekdays: readonly number[]): string {
  const sorted = [...weekdays].sort((a, b) => a - b);
  const name = (day: number) => WEEKDAY_NAMES[day - 1] ?? '';
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (first === undefined || last === undefined) return '';
  if (sorted.length === 1) return name(first);
  if (last - first === sorted.length - 1) return `${name(first)}–${name(last)}`;
  return sorted.map(name).join(', ');
}

/** 420, 570 -> "07:00–09:30". */
export function formatWindow(startMinute: number, endMinute: number): string {
  return `${minuteToHHMM(startMinute)}–${minuteToHHMM(endMinute)}`;
}

/** "2026-11-04T22:00:00.000Z" -> "04/11/2026 · 19:00" in São Paulo time. */
export function formatDateTime(instant: string): string {
  const local = utcToLocal(new Date(instant));
  return `${formatLocalDateBR(local.date)} · ${minuteToHHMM(local.minuteOfDay)}`;
}

/** "2026-11-02" -> "Seg 02/11/2026". */
export function formatWeekdayDate(date: string): string {
  return `${WEEKDAY_NAMES[weekdayOf(date as LocalDate) - 1] ?? ''} ${formatLocalDateBR(date)}`;
}

/** An occurrence as "Seg 02/11/2026 · 07:00–09:30" in São Paulo time. */
export function formatOccurrence(occurrence: {
  date: string;
  startsAt: string;
  endsAt: string;
}): string {
  const start = utcToLocal(new Date(occurrence.startsAt)).minuteOfDay;
  const end = utcToLocal(new Date(occurrence.endsAt)).minuteOfDay;
  return `${formatWeekdayDate(occurrence.date)} · ${formatWindow(start, end)}`;
}

/** REC-91: "22 ocorrências × R$ 280,00 = R$ 6.160,00" ("1 ocorrência" when there is one). */
export function formatPeriodPrice(count: number, perOccurrenceCents: number): string {
  const noun = count === 1 ? 'ocorrência' : 'ocorrências';
  return `${String(count)} ${noun} × ${formatBRL(perOccurrenceCents)} = ${formatBRL(count * perOccurrenceCents)}`;
}
