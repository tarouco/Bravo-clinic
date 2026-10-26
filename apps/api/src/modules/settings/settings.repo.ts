import {
  parseSetting,
  settingDefaults,
  settingKeys,
  type SettingKey,
  type SettingsValues,
} from '@bravo/core';
import type { Db, Tx } from '../../db/client';
import { settings } from '../../db/schema';

/** Every catalog key with its stored value, or the factory default when the row is missing or invalid. */
export async function loadSettings(db: Db | Tx): Promise<SettingsValues> {
  const rows = await db.select().from(settings);
  const stored = new Map(rows.map((row) => [row.key, row.value]));
  const values: Record<string, unknown> = settingDefaults();
  for (const key of settingKeys) {
    if (!stored.has(key)) continue;
    try {
      values[key] = parseSetting(key, stored.get(key));
    } catch {
      // A hand-edited invalid value must not take the site down: keep the factory default.
    }
  }
  return values as SettingsValues;
}

/** Writes one setting row; the value is validated against the catalog first. */
export async function saveSetting<K extends SettingKey>(
  tx: Tx,
  key: K,
  value: unknown,
  updatedBy: string | null,
): Promise<void> {
  const parsed = parseSetting(key, value);
  await tx
    .insert(settings)
    .values({ key, value: parsed, updatedBy })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: parsed, updatedBy, updatedAt: new Date() },
    });
}
