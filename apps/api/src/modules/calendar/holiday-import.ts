import { utcToLocal } from '@bravo/core';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { withTransaction, type Db } from '../../db/client';
import { holidays } from '../../db/schema';
import { audit, type RequestContext } from '../../lib/audit';
import { AppError } from '../../lib/errors';
import { logger } from '../../lib/logger';

const BRASIL_API = 'https://brasilapi.com.br/api/feriados/v1';
const TIMEOUT_MS = 10_000;

const brasilApiSchema = z.array(
  z.object({ date: z.iso.date(), name: z.string().min(1), type: z.string() }),
);

const unavailable = () =>
  new AppError(502, 'EXTERNAL_UNAVAILABLE', 'Não foi possível consultar os feriados agora.');

export interface HolidayImportDeps {
  fetch: typeof fetch;
  now: () => Date;
  /** When present the import is audited (`holiday.import`) in the same transaction. */
  ctx?: RequestContext;
}

async function fetchNationalHolidays(deps: HolidayImportDeps, year: number) {
  try {
    const response = await deps.fetch(`${BRASIL_API}/${String(year)}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`BrasilAPI responded ${String(response.status)}`);
    const parsed = brasilApiSchema.parse(await response.json());
    return parsed.filter((h) => h.type === 'national');
  } catch (error) {
    logger.warn('holiday import failed', {
      year,
      error: { name: (error as Error).name, message: (error as Error).message },
    });
    throw unavailable();
  }
}

/**
 * Imports the national holidays of the current or next year (NUC-46, NUC-47, NUC-204). Missing
 * dates are inserted with `source = 'brasilapi'`; an existing national holiday of the same date
 * only gets the new name (when `renameExisting`, the default) and keeps its `isClosed` decision.
 * Gestao's weekly job passes `renameExisting: false`, which makes the import insert-only.
 */
export async function importNationalHolidays(
  db: Db,
  year: number,
  deps: HolidayImportDeps,
  opts: { renameExisting?: boolean } = {},
): Promise<{ inserted: number; updated: number }> {
  const currentYear = Number(utcToLocal(deps.now()).date.slice(0, 4));
  if (year !== currentYear && year !== currentYear + 1) {
    throw new AppError(422, 'VALIDATION_FAILED', 'Dados inválidos', [
      { path: 'year', message: 'Importe apenas o ano atual ou o próximo' },
    ]);
  }
  const incoming = await fetchNationalHolidays(deps, year);
  const rename = opts.renameExisting !== false;

  return withTransaction(db, async (tx) => {
    let inserted = 0;
    let updated = 0;
    for (const holiday of incoming) {
      const [existing] = await tx
        .select()
        .from(holidays)
        .where(and(eq(holidays.date, holiday.date), eq(holidays.scope, 'national')));
      if (existing === undefined) {
        const rows = await tx
          .insert(holidays)
          .values({
            date: holiday.date,
            name: holiday.name,
            scope: 'national',
            source: 'brasilapi',
          })
          .onConflictDoNothing()
          .returning({ id: holidays.id });
        inserted += rows.length;
      } else if (rename && existing.name !== holiday.name) {
        await tx
          .update(holidays)
          .set({ name: holiday.name, updatedAt: new Date() })
          .where(eq(holidays.id, existing.id));
        updated += 1;
      }
    }
    if (deps.ctx !== undefined) {
      await audit(tx, deps.ctx, {
        action: 'holiday.import',
        entityType: 'holiday',
        entityId: String(year),
        after: { year, inserted, updated },
      });
    }
    return { inserted, updated };
  });
}
