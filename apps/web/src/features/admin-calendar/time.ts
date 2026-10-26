const pad2 = (n: number): string => String(n).padStart(2, '0');

/** Minute of the day as "HH:MM"; the end of the day (1440) reads "24:00". */
export function formatHHMM(minute: number): string {
  return `${pad2(Math.floor(minute / 60))}:${pad2(minute % 60)}`;
}

/** "7:30", "07:30", "0730" and "24:00" to minutes of the day; null when it is not a time. */
export function parseHHMM(text: string): number | null {
  const match = /^(\d{1,2}):?(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (minutes > 59) return null;
  const total = hours * 60 + minutes;
  return total > 1440 ? null : total;
}

/** Minute of the day under a pointer inside a column, snapped to the slot grid and clamped. */
export function minuteFromPointer(
  clientY: number,
  column: { top: number; height: number },
  slotMinutes: number,
): number {
  if (column.height <= 0) return 0;
  const ratio = Math.min(1, Math.max(0, (clientY - column.top) / column.height));
  return Math.round((ratio * 1440) / slotMinutes) * slotMinutes;
}
