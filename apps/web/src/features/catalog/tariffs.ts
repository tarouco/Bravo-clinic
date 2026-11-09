import { formatBRL, minuteToHHMM, type Catalog, type Clinic } from '@bravo/core';

// The Home tariff table, built from the live catalog (the categories the admin configures) and
// clipped to the clinic business hours, so a price, window or new category edited in the admin
// shows on the site without a deploy.

type DayKind = 'weekday' | 'all' | 'weekend';
type BusinessHours = Clinic['businessHours'];

export interface TariffRow {
  label: string;
  price: string;
  /** The lowest hourly rate of the catalog (the "a partir de" price). */
  highlight: boolean;
}

export interface TariffGroup {
  title: string;
  rows: TariffRow[];
}

interface Draft {
  kind: DayKind;
  startMinute: number;
  endMinute: number;
  hourly: { label: string; cents: number; order: number }[];
  blocks: { label: string; cents: number; start: number }[];
}

const KIND_ORDER: Record<DayKind, number> = { weekday: 0, all: 1, weekend: 2 };
const KIND_LABEL: Record<DayKind, string> = {
  weekday: 'Dias úteis',
  all: 'Todos os dias',
  weekend: 'Sábados, domingos e feriados',
};
const KIND_DAYS: Record<DayKind, BusinessHours[number]['dayType'][]> = {
  weekday: ['mon', 'tue', 'wed', 'thu', 'fri'],
  weekend: ['sat', 'sun', 'holiday'],
  all: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun', 'holiday'],
};

const hasWeekday = (days: number[]) => days.some((d) => d >= 1 && d <= 5);
const hasWeekend = (days: number[], holidays: boolean) => holidays || days.some((d) => d >= 6);

/** The opening window of a day kind: earliest opening to latest closing of its open days. */
function openWindow(kind: DayKind, hours: BusinessHours | undefined) {
  const open = (hours ?? []).filter((h) => KIND_DAYS[kind].includes(h.dayType) && !h.isClosed);
  if (open.length === 0) return hours === undefined ? { start: 0, end: 1440 } : null;
  return {
    start: Math.min(...open.map((h) => h.openMinute)),
    end: Math.max(...open.map((h) => h.closeMinute)),
  };
}

/** "Meio turno comercial (07:00–09:30)". */
const blockLabel = (name: string, start: number, end: number) =>
  `${name} (${minuteToHHMM(start)}–${minuteToHHMM(end)})`;

/**
 * Tariff groups by day kind and time window: each hourly category gives a weekday row (weekday
 * rate) and a weekend/holiday row (weekend rate); a window whose weekday and weekend rows are the
 * same becomes one "Todos os dias" group. Fixed blocks join the group of their day kind whose
 * window contains them, or get their own. Titles show the window clipped to the business hours,
 * and groups outside the opening hours are left out.
 */
export function buildTariffGroups(catalog: Catalog, hours?: BusinessHours): TariffGroup[] {
  const drafts = new Map<string, Draft>();
  const draft = (kind: DayKind, startMinute: number, endMinute: number) => {
    const key = `${kind}:${startMinute}:${endMinute}`;
    let found = drafts.get(key);
    if (!found) {
      found = { kind, startMinute, endMinute, hourly: [], blocks: [] };
      drafts.set(key, found);
    }
    return found;
  };

  for (const cat of catalog.hourly) {
    const row = (cents: number) => ({ label: cat.name, cents, order: cat.displayOrder });
    if (hasWeekday(cat.weekdays))
      draft('weekday', cat.startMinute, cat.endMinute).hourly.push(row(cat.weekdayRateCents));
    if (hasWeekend(cat.weekdays, cat.appliesOnHolidays))
      draft('weekend', cat.startMinute, cat.endMinute).hourly.push(row(cat.weekendRateCents));
  }

  // Same window, same rows on weekdays and weekends: one "Todos os dias" group.
  const signature = (d: Draft) =>
    JSON.stringify([...d.hourly].sort((a, b) => a.order - b.order).map((r) => [r.label, r.cents]));
  for (const weekday of [...drafts.values()].filter((d) => d.kind === 'weekday')) {
    const weekendKey = `weekend:${weekday.startMinute}:${weekday.endMinute}`;
    const weekend = drafts.get(weekendKey);
    if (!weekend || signature(weekend) !== signature(weekday)) continue;
    drafts.delete(weekendKey);
    drafts.delete(`weekday:${weekday.startMinute}:${weekday.endMinute}`);
    const all = draft('all', weekday.startMinute, weekday.endMinute);
    all.hourly.push(...weekday.hourly);
  }

  for (const block of catalog.blocks) {
    const kinds: DayKind[] = [];
    if (hasWeekday(block.weekdays)) kinds.push('weekday');
    if (hasWeekend(block.weekdays, block.appliesOnHolidays)) kinds.push('weekend');
    for (const kind of kinds) {
      const host =
        [...drafts.values()].find(
          (d) =>
            (d.kind === kind || d.kind === 'all') &&
            d.startMinute <= block.startMinute &&
            d.endMinute >= block.endMinute,
        ) ?? draft(kind, block.startMinute, block.endMinute);
      host.blocks.push({
        label: blockLabel(block.name, block.startMinute, block.endMinute),
        cents: block.fixedPriceCents,
        start: block.startMinute,
      });
    }
  }

  const rates = catalog.hourly.flatMap((c) => [c.weekdayRateCents, c.weekendRateCents]);
  const lowest = rates.length === 0 ? null : Math.min(...rates);

  return [...drafts.values()]
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.startMinute - b.startMinute)
    .flatMap((d) => {
      const open = openWindow(d.kind, hours);
      const start = Math.max(d.startMinute, open?.start ?? 0);
      const end = Math.min(d.endMinute, open?.end ?? 0);
      if (open === null || end <= start) return [];
      const rows: TariffRow[] = [
        ...[...d.hourly]
          .sort((a, b) => a.order - b.order)
          .map((r) => ({
            label: r.label,
            price: `${formatBRL(r.cents)}/h`,
            highlight: r.cents === lowest,
          })),
        ...[...d.blocks]
          .sort((a, b) => a.start - b.start)
          .map((r) => ({ label: r.label, price: formatBRL(r.cents), highlight: false })),
      ];
      return [
        {
          title: `${KIND_LABEL[d.kind]} (${minuteToHHMM(start)} às ${minuteToHHMM(end)})`,
          rows,
        },
      ];
    });
}

/**
 * Booking length from which a cheaper hourly rate applies to every hour, in minutes: the
 * smallest `minDurationMinutes` of a category that undercuts a shorter one in an overlapping
 * window. Null when the catalog has no such progressive discount.
 */
export function discountFromMinutes(hourly: Catalog['hourly']): number | null {
  let best: number | null = null;
  for (const long of hourly) {
    const undercuts = hourly.some(
      (short) =>
        short.minDurationMinutes < long.minDurationMinutes &&
        short.startMinute < long.endMinute &&
        long.startMinute < short.endMinute &&
        (long.weekdayRateCents < short.weekdayRateCents ||
          long.weekendRateCents < short.weekendRateCents),
    );
    if (undercuts && (best === null || long.minDurationMinutes < best))
      best = long.minDurationMinutes;
  }
  return best;
}

/** 120 -> "2 horas", 90 -> "1h30", 60 -> "1 hora". */
export function hoursPhrase(minutes: number): string {
  if (minutes % 60 !== 0)
    return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}`;
  const h = minutes / 60;
  return h === 1 ? '1 hora' : `${h} horas`;
}
