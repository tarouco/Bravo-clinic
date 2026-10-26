import type { AdminCategory, HourlyCategory } from '@bravo/core';

/** The hourly categories of the admin list in the shape the core pricing functions take. */
export function toHourlyCategories(items: readonly AdminCategory[]): HourlyCategory[] {
  const out: HourlyCategory[] = [];
  for (const c of items) {
    if (
      c.type !== 'hourly' ||
      c.weekdayRateCents === null ||
      c.weekendRateCents === null ||
      c.minDurationMinutes === null
    ) {
      continue;
    }
    out.push({
      id: c.id,
      name: c.name,
      weekdays: c.weekdays,
      appliesOnHolidays: c.appliesOnHolidays,
      startMinute: c.startMinute,
      endMinute: c.endMinute,
      weekdayRateCents: c.weekdayRateCents,
      weekendRateCents: c.weekendRateCents,
      minDurationMinutes: c.minDurationMinutes,
      status: c.status,
      isReference: c.isReference,
      displayOrder: c.displayOrder,
    });
  }
  return out;
}

/** 160000 -> "1.600,00": what a price input shows. */
export function centsToInput(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
