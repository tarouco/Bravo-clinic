import type { ExtraServiceInput } from '@bravo/core';
import { asc, eq } from 'drizzle-orm';
import type { Db, Tx } from '../../db/client';
import { extraServices } from '../../db/schema';
import { audit, type RequestContext } from '../../lib/audit';
import { notFound } from '../../lib/errors';

// Serviços extras (GES-84..GES-86): the admin catalog and its public, active-only list.

export type ExtraServiceRow = typeof extraServices.$inferSelect;

/** Admin row of the web contract (`GET /admin/extra-services`). */
export const extraServiceView = (s: ExtraServiceRow) => ({
  id: s.id,
  name: s.name,
  description: s.description,
  referencePriceCents: s.referencePriceCents,
  unit: s.unit as ExtraServiceInput['unit'],
  saleMode: s.saleMode as ExtraServiceInput['saleMode'],
  status: s.status as ExtraServiceInput['status'],
  displayOrder: s.displayOrder,
});
export type ExtraServiceView = ReturnType<typeof extraServiceView>;

const auditable = (s: ExtraServiceRow) => ({
  name: s.name,
  description: s.description,
  referencePriceCents: s.referencePriceCents,
  unit: s.unit,
  saleMode: s.saleMode,
  status: s.status,
  displayOrder: s.displayOrder,
});

const ordered = [asc(extraServices.displayOrder), asc(extraServices.name)];

/** Every service, inactive ones included, in display order. */
export async function listExtraServices(db: Db | Tx): Promise<{ items: ExtraServiceView[] }> {
  const rows = await db
    .select()
    .from(extraServices)
    .orderBy(...ordered);
  return { items: rows.map(extraServiceView) };
}

/** `GET /public/extra-services` (GES-86): active services in display order. */
export async function listPublicExtraServices(db: Db | Tx) {
  const rows = await db
    .select()
    .from(extraServices)
    .where(eq(extraServices.status, 'active'))
    .orderBy(...ordered);
  return {
    items: rows.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      referencePriceCents: s.referencePriceCents,
      unit: s.unit as ExtraServiceInput['unit'],
      saleMode: s.saleMode as ExtraServiceInput['saleMode'],
    })),
  };
}

/** Creates a service with audit `extra_service.create` (GES-84). */
export async function createExtraService(
  tx: Tx,
  ctx: RequestContext,
  input: ExtraServiceInput,
): Promise<ExtraServiceView> {
  const [row] = await tx.insert(extraServices).values(input).returning();
  if (row === undefined) throw new Error('extra service insert returned no row');
  await audit(tx, ctx, {
    action: 'extra_service.create',
    entityType: 'extra_service',
    entityId: row.id,
    after: auditable(row),
  });
  return extraServiceView(row);
}

/** Replaces a service's fields with audit `extra_service.update` (before/after, GES-84). */
export async function updateExtraService(
  tx: Tx,
  ctx: RequestContext,
  id: string,
  input: ExtraServiceInput,
  now: Date,
): Promise<ExtraServiceView> {
  const [before] = await tx
    .select()
    .from(extraServices)
    .where(eq(extraServices.id, id))
    .for('update');
  if (before === undefined) throw notFound('NOT_FOUND', 'Serviço não encontrado');
  const [row] = await tx
    .update(extraServices)
    .set({ ...input, updatedAt: now })
    .where(eq(extraServices.id, id))
    .returning();
  if (row === undefined) throw new Error('extra service update returned no row');
  await audit(tx, ctx, {
    action: 'extra_service.update',
    entityType: 'extra_service',
    entityId: id,
    before: auditable(before),
    after: auditable(row),
  });
  return extraServiceView(row);
}
