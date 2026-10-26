const DAY_MS = 86_400_000;

/** `instant + days × 24 h` (validity windows of credits and extra lots; São Paulo has no DST). */
export function addDaysToInstant(instant: Date, days: number): Date {
  return new Date(instant.getTime() + days * DAY_MS);
}

/** `instant + hours` (checkout and sale-link holds). */
export function addHoursToInstant(instant: Date, hours: number): Date {
  return new Date(instant.getTime() + hours * 3_600_000);
}
