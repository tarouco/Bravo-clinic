import {
  categoryAverageHourlyCents,
  type AdminCategory,
  type AnyCategory,
  type CategoryCreateInput,
  type CategoryUpdateInput,
} from '@bravo/core';
import { asc, eq, sql } from 'drizzle-orm';
import type { Db, Tx } from '../../db/client';
import { bookingCategories } from '../../db/schema';
import type { Registry } from '../../extensions/registry';
import { audit, type RequestContext } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { loadSettings, saveSetting } from '../settings/settings.repo';

type CategoryRow = typeof bookingCategories.$inferSelect;
type Handlers = Pick<Registry, 'categoryHandlers'>;

const MANAGED_BY_PACKAGES = 'Tipo de categoria gerenciado em Pacotes';
const REFERENCE_INACTIVE = 'Defina outra categoria de referência antes de desativar esta.';

const invalid = (path: string, message: string) =>
  new AppError(422, 'VALIDATION_FAILED', 'Dados inválidos', [{ path, message }]);

function anyCategoryOf(row: CategoryRow): AnyCategory {
  const base = { id: row.id, name: row.name };
  const days = { weekdays: row.weekdays, appliesOnHolidays: row.appliesOnHolidays };
  switch (row.type) {
    case 'hourly':
      return {
        type: 'hourly',
        ...base,
        ...days,
        startMinute: row.startMinute,
        endMinute: row.endMinute,
        weekdayRateCents: row.weekdayRateCents ?? 0,
        weekendRateCents: row.weekendRateCents ?? 0,
        minDurationMinutes: row.minDurationMinutes ?? 60,
        status: row.status as 'active' | 'inactive',
        isReference: row.isReference,
        displayOrder: row.displayOrder,
      };
    case 'block':
      return {
        type: 'block',
        ...base,
        ...days,
        startMinute: row.startMinute,
        endMinute: row.endMinute,
        fixedPriceCents: row.fixedPriceCents ?? 0,
      };
    case 'hour_package':
      return {
        type: 'hour_package',
        ...base,
        fixedPriceCents: row.fixedPriceCents ?? 0,
        includedMinutes: row.includedMinutes ?? 60,
      };
    default:
      return {
        type: 'fixed_schedule',
        ...base,
        startMinute: row.startMinute,
        endMinute: row.endMinute,
        pricePerOccurrenceCents: row.pricePerOccurrenceCents ?? 0,
      };
  }
}

function view(row: CategoryRow, handlers: Handlers): AdminCategory {
  const type = row.type as AdminCategory['type'];
  return {
    id: row.id,
    name: row.name,
    type,
    weekdays: row.weekdays,
    appliesOnHolidays: row.appliesOnHolidays,
    startMinute: row.startMinute,
    endMinute: row.endMinute,
    weekdayRateCents: row.weekdayRateCents,
    weekendRateCents: row.weekendRateCents,
    minDurationMinutes: row.minDurationMinutes,
    fixedPriceCents: row.fixedPriceCents,
    pricePerOccurrenceCents: row.pricePerOccurrenceCents,
    includedMinutes: row.includedMinutes,
    period: row.period as AdminCategory['period'],
    isReference: row.isReference,
    status: row.status as AdminCategory['status'],
    visibility: row.visibility as AdminCategory['visibility'],
    roomId: row.roomId,
    displayOrder: row.displayOrder,
    version: row.version,
    averageHourlyCents: categoryAverageHourlyCents(anyCategoryOf(row)),
    editable:
      type === 'hourly' ||
      type === 'block' ||
      handlers.categoryHandlers.some((h) => h.type === type),
  };
}

/** NUC-61: all four types by display order, with the average hourly value. */
export async function listCategories(db: Db | Tx, handlers: Handlers): Promise<AdminCategory[]> {
  const rows = await db
    .select()
    .from(bookingCategories)
    .orderBy(asc(bookingCategories.displayOrder), asc(bookingCategories.createdAt));
  return rows.map((row) => view(row, handlers));
}

async function getRow(tx: Tx, id: string): Promise<CategoryRow> {
  const [row] = await tx.select().from(bookingCategories).where(eq(bookingCategories.id, id));
  if (row === undefined) throw notFound();
  return row;
}

/** Window and minimum duration must sit on the slot grid and inside the day. */
function assertGrid(
  slot: number,
  row: { startMinute: number; endMinute: number; minDurationMinutes?: number | null },
): void {
  const fields = [
    ['startMinute', row.startMinute],
    ['endMinute', row.endMinute],
    ['minDurationMinutes', row.minDurationMinutes ?? 0],
  ] as const;
  for (const [path, value] of fields) {
    if (value % slot !== 0) throw invalid(path, `Use múltiplos de ${String(slot)} minutos`);
  }
  if (row.endMinute <= row.startMinute) {
    throw invalid('endMinute', 'O fim precisa ser depois do início');
  }
  if (row.endMinute > 1440) throw invalid('endMinute', 'Horário inválido');
}

async function nextDisplayOrder(tx: Tx): Promise<number> {
  const [row] = await tx
    .select({ max: sql<number>`coalesce(max(${bookingCategories.displayOrder}), 0)` })
    .from(bookingCategories);
  return Number(row?.max ?? 0) + 1;
}

/** NUC-62..NUC-64: hourly and block categories; other types go through a registered handler. */
export async function createCategory(
  tx: Tx,
  input: CategoryCreateInput,
  ctx: RequestContext,
  handlers: Handlers,
): Promise<AdminCategory> {
  const slot = (await loadSettings(tx))['calendar.slot_minutes'];
  const displayOrder = await nextDisplayOrder(tx);
  let values: typeof bookingCategories.$inferInsert;

  if (input.type === 'hourly') {
    assertGrid(slot, input);
    values = {
      name: input.name,
      type: 'hourly',
      weekdays: input.weekdays,
      appliesOnHolidays: input.appliesOnHolidays,
      startMinute: input.startMinute,
      endMinute: input.endMinute,
      weekdayRateCents: input.weekdayRateCents,
      weekendRateCents: input.weekendRateCents,
      minDurationMinutes: input.minDurationMinutes,
      period: 'single',
      status: input.status ?? 'active',
      visibility: input.visibility ?? 'public',
      displayOrder,
    };
  } else if (input.type === 'block') {
    assertGrid(slot, input);
    values = {
      name: input.name,
      type: 'block',
      weekdays: input.weekdays,
      appliesOnHolidays: input.appliesOnHolidays,
      startMinute: input.startMinute,
      endMinute: input.endMinute,
      fixedPriceCents: input.fixedPriceCents,
      period: 'single',
      status: input.status ?? 'active',
      visibility: input.visibility ?? 'public',
      displayOrder,
    };
  } else {
    const handler = handlers.categoryHandlers.find((h) => h.type === input.type);
    if (handler === undefined) throw invalid('type', MANAGED_BY_PACKAGES);
    const parsed = handler.schema.safeParse(input);
    if (!parsed.success) {
      throw new AppError(
        422,
        'VALIDATION_FAILED',
        'Dados inválidos',
        parsed.error.issues.map((i) => ({
          path: i.path.map(String).join('.'),
          message: i.message,
        })),
      );
    }
    values = {
      name: (input as { name?: string }).name ?? '',
      type: input.type,
      period: 'monthly',
      displayOrder,
      ...handler.toRow(parsed.data),
    };
  }

  const [row] = await tx.insert(bookingCategories).values(values).returning();
  if (row === undefined) throw new Error('createCategory: insert returned no row');
  await audit(tx, ctx, {
    action: 'category.create',
    entityType: 'booking_category',
    entityId: row.id,
    after: values,
  });
  return view(row, handlers);
}

const PRICING_FIELDS = [
  'weekdays',
  'appliesOnHolidays',
  'startMinute',
  'endMinute',
  'weekdayRateCents',
  'weekendRateCents',
  'minDurationMinutes',
  'fixedPriceCents',
] as const;

const FIELDS_BY_TYPE: Record<string, readonly string[]> = {
  hourly: ['weekdayRateCents', 'weekendRateCents', 'minDurationMinutes'],
  block: ['fixedPriceCents'],
};

/**
 * NUC-65, NUC-67: partial update. A price, window or day change bumps `version` and is audited
 * with before and after; frozen booking segments are never touched. A registered handler's
 * `onUpdate` runs before the row is persisted.
 */
export async function updateCategory(
  tx: Tx,
  id: string,
  patch: CategoryUpdateInput,
  ctx: RequestContext,
  handlers: Handlers,
): Promise<AdminCategory> {
  const before = await getRow(tx, id);
  const handler = handlers.categoryHandlers.find((h) => h.type === before.type);
  if (before.type !== 'hourly' && before.type !== 'block' && handler === undefined) {
    throw invalid('type', MANAGED_BY_PACKAGES);
  }
  const allowed = FIELDS_BY_TYPE[before.type];
  if (allowed !== undefined) {
    for (const field of [
      'weekdayRateCents',
      'weekendRateCents',
      'minDurationMinutes',
      'fixedPriceCents',
    ] as const) {
      if (patch[field] !== undefined && !allowed.includes(field)) {
        throw invalid(field, 'Campo não se aplica a este tipo de categoria');
      }
    }
  }
  if (patch.status === 'inactive' && before.isReference) {
    throw invalid('status', REFERENCE_INACTIVE);
  }

  const next = {
    ...before,
    ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)),
  };
  if (before.type === 'hourly' || before.type === 'block') {
    assertGrid((await loadSettings(tx))['calendar.slot_minutes'], {
      startMinute: next.startMinute,
      endMinute: next.endMinute,
      minDurationMinutes: before.type === 'hourly' ? next.minDurationMinutes : 0,
    });
  }
  const changedPricing = PRICING_FIELDS.some(
    (field) => JSON.stringify(next[field]) !== JSON.stringify(before[field]),
  );
  const after: CategoryRow = {
    ...next,
    version: changedPricing ? before.version + 1 : before.version,
    updatedAt: new Date(),
  };
  if (handler?.onUpdate !== undefined) await handler.onUpdate(tx, before, after, ctx);

  const [saved] = await tx
    .update(bookingCategories)
    .set({
      name: after.name,
      weekdays: after.weekdays,
      appliesOnHolidays: after.appliesOnHolidays,
      startMinute: after.startMinute,
      endMinute: after.endMinute,
      weekdayRateCents: after.weekdayRateCents,
      weekendRateCents: after.weekendRateCents,
      minDurationMinutes: after.minDurationMinutes,
      fixedPriceCents: after.fixedPriceCents,
      status: after.status,
      visibility: after.visibility,
      version: after.version,
      updatedAt: after.updatedAt,
    })
    .where(eq(bookingCategories.id, id))
    .returning();
  if (saved === undefined) throw notFound();
  await audit(tx, ctx, {
    action: 'category.update',
    entityType: 'booking_category',
    entityId: id,
    before: pick(before),
    after: pick(saved),
  });
  return view(saved, handlers);
}

function pick(row: CategoryRow) {
  return {
    name: row.name,
    weekdays: row.weekdays,
    appliesOnHolidays: row.appliesOnHolidays,
    startMinute: row.startMinute,
    endMinute: row.endMinute,
    weekdayRateCents: row.weekdayRateCents,
    weekendRateCents: row.weekendRateCents,
    minDurationMinutes: row.minDurationMinutes,
    fixedPriceCents: row.fixedPriceCents,
    status: row.status,
    visibility: row.visibility,
    version: row.version,
  };
}

/** NUC-66: V_ref moves to an active hourly category, atomically. */
export async function setReference(
  tx: Tx,
  id: string,
  ctx: RequestContext,
  handlers: Handlers,
): Promise<AdminCategory> {
  const target = await getRow(tx, id);
  if (target.type !== 'hourly') {
    throw invalid('type', 'A categoria de referência precisa ser do tipo hora avulsa');
  }
  if (target.status !== 'active') {
    throw invalid('status', 'Ative a categoria antes de defini-la como referência');
  }
  const [previous] = await tx
    .select({ id: bookingCategories.id, name: bookingCategories.name })
    .from(bookingCategories)
    .where(eq(bookingCategories.isReference, true));
  await tx
    .update(bookingCategories)
    .set({ isReference: false, updatedAt: new Date() })
    .where(eq(bookingCategories.isReference, true));
  const [row] = await tx
    .update(bookingCategories)
    .set({ isReference: true, updatedAt: new Date() })
    .where(eq(bookingCategories.id, id))
    .returning();
  if (row === undefined) throw notFound();
  await audit(tx, ctx, {
    action: 'category.set_reference',
    entityType: 'booking_category',
    entityId: id,
    before: { referenceId: previous?.id ?? null, referenceName: previous?.name ?? null },
    after: { referenceId: id, referenceName: row.name },
  });
  return view(row, handlers);
}

/** NUC-68: display orders 1..n in the given order; `ids` must list every category once. */
export async function reorderCategories(
  tx: Tx,
  ids: string[],
  ctx: RequestContext,
  handlers: Handlers,
): Promise<AdminCategory[]> {
  const rows = await tx.select({ id: bookingCategories.id }).from(bookingCategories);
  const known = new Set(rows.map((r) => r.id));
  const complete = ids.length === known.size && ids.every((id) => known.has(id));
  if (!complete) throw invalid('ids', 'Informe todas as categorias, uma única vez');
  for (const [index, id] of ids.entries()) {
    await tx
      .update(bookingCategories)
      .set({ displayOrder: index + 1, updatedAt: new Date() })
      .where(eq(bookingCategories.id, id));
  }
  await audit(tx, ctx, {
    action: 'category.reorder',
    entityType: 'booking_category',
    after: { ids },
  });
  return listCategories(tx, handlers);
}

/** NUC-69: the admin confirms the example prices; tenant self-service booking opens (NUC-70). */
export async function markPricesReviewed(tx: Tx, ctx: RequestContext): Promise<void> {
  await saveSetting(tx, 'onboarding.prices_reviewed', true, ctx.actorUserId);
  await audit(tx, ctx, {
    action: 'onboarding.prices_reviewed',
    entityType: 'settings',
    entityId: 'onboarding.prices_reviewed',
    after: { pricesReviewed: true },
  });
}
