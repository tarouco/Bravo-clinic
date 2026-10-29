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

/**
 * Band colors of the hourly categories, from the v3 palette (DESIGN-v3.md): a 4px accent bar plus
 * a light tint, with the band text in `ink`. The tints stay light enough that `ink` reads at
 * >=4.5:1 over pearl and over the sunken free slots in Dia and Noite (gold tints thin out in Noite,
 * where the text itself is gold). Measured minimums, Dia / Noite: emerald 7.2 / 8.6,
 * gold 9.0 / 6.1, brown 7.2 / 8.5, ink-muted 7.1 / 5.9, emerald-deep 6.8 / 9.4, gold-deep 8.0 / 6.0.
 */
export const CATEGORY_TONES = [
  { name: 'emerald', band: 'border-emerald bg-emerald/[0.16]', swatch: 'bg-emerald' },
  { name: 'gold', band: 'border-gold-deep bg-gold/[0.55] dark:bg-gold/[0.14]', swatch: 'bg-gold' },
  { name: 'brown', band: 'border-brown bg-brown/[0.14]', swatch: 'bg-brown' },
  { name: 'ink-muted', band: 'border-ink-muted bg-ink-muted/[0.18]', swatch: 'bg-ink-muted' },
  {
    name: 'emerald-deep',
    band: 'border-emerald-deep bg-emerald-deep/[0.16]',
    swatch: 'bg-emerald-deep',
  },
  {
    name: 'gold-deep',
    band: 'border-emerald bg-gold-deep/40 dark:bg-gold-deep/[0.18]',
    swatch: 'bg-gold-deep',
  },
] as const;

export type CategoryTone = (typeof CATEGORY_TONES)[number];

/** The tone of the category at `index` in the list, cycling through the palette. */
export function categoryTone(index: number): CategoryTone {
  const size = CATEGORY_TONES.length;
  return CATEGORY_TONES[((index % size) + size) % size] ?? CATEGORY_TONES[0];
}
