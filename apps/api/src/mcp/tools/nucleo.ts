import {
  adminBookingsQuerySchema,
  adminCancelSchema,
  adminRescheduleSchema,
  blockCreateSchema,
  bookingCodeSchema,
  calendarEventsQuerySchema,
  confirmManualSchema,
  formatBRL,
  formatDateTimeBR,
  idSchema,
  justificationSchema,
  localDateSchema,
  staffCreateBookingSchema,
} from '@bravo/core';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { withTransaction } from '../../db/client';
import { blocks, bookings, charges, rooms } from '../../db/schema';
import { audit } from '../../lib/audit';
import { notFound } from '../../lib/errors';
import {
  adminCalendarEvents,
  listAdminBookings,
} from '../../modules/admin/booking-queries.service';
import { getDayAvailability } from '../../modules/availability/availability.service';
import { loadBookingDetail } from '../../modules/booking/booking-serializer.service';
import { cancelBooking, previewCancellation } from '../../modules/booking/cancel.service';
import { rescheduleBooking } from '../../modules/booking/reschedule.service';
import {
  checkIn,
  confirmManual,
  resendPaymentLink,
  staffCreateBooking,
} from '../../modules/booking/staff-booking.service';
import { getRoomById } from '../../modules/calendar/calendar.repo';
import { createBlocks, deleteBlock } from '../../modules/calendar/blocks.service';
import { listCategories } from '../../modules/catalog/categories.service';
import { processRefund, requestRefund } from '../../modules/payments/refunds.service';
import { getPolicySettings } from '../../modules/settings/policies.service';
import { defineTool, type ToolContext, type ToolDefinition } from '../server';

// nucleo tools of design "MCP tool catalog" (R10). Inputs are the shared core schemas of the
// matching Admin routes; each wrapper builds the service arguments from the tool context.

const bookingIdInput = z.object({ bookingId: idSchema });

async function bookingRow(tc: ToolContext, id: string) {
  const [row] = await tc.deps.db.select().from(bookings).where(eq(bookings.id, id));
  if (row === undefined) throw notFound('NOT_FOUND', 'Reserva não encontrada');
  return row;
}

const detail = async (tc: ToolContext, row: typeof bookings.$inferSelect) =>
  loadBookingDetail(tc.deps.db, row, tc.deps.now(), tc.deps.registry);

/** Staff (admin) actor of the services that need one. */
const staffOf = (tc: ToolContext) => ({ id: tc.owner.userId, role: 'admin' as const });

const createShape = z.object(staffCreateBookingSchema.shape);

export function nucleoTools(): ToolDefinition[] {
  return [
    defineTool({
      name: 'agenda_list',
      description:
        'Lista reservas, bloqueios, dias fechados e feriados de um período de até 42 dias, opcionalmente por sala e status.',
      scope: 'read',
      input: calendarEventsQuerySchema,
      run: (tc, input) => adminCalendarEvents(tc.deps.db, input, tc.deps.now()),
    }),
    defineTool({
      name: 'availability_get',
      description:
        'Mostra os horários livres de uma sala (pelo endereço, ex.: "principal") em uma data.',
      scope: 'read',
      input: z.object({
        roomSlug: z.string({ error: 'Informe a sala' }).trim().min(1, { error: 'Informe a sala' }),
        date: localDateSchema,
      }),
      run: (tc, input) =>
        getDayAvailability(tc.deps.db, input.roomSlug, input.date, tc.deps.now(), tc.deps.registry),
    }),
    defineTool({
      name: 'booking_get',
      description: 'Detalhes de uma reserva pelo id ou pelo código (BRV-XXXXXX).',
      scope: 'read',
      input: z
        .object({
          id: idSchema.optional(),
          code: bookingCodeSchema.optional(),
        })
        .refine((v) => v.id !== undefined || v.code !== undefined, {
          error: 'Informe o id ou o código da reserva',
          path: ['id'],
        }),
      run: async (tc, input) => {
        const [row] = await tc.deps.db
          .select()
          .from(bookings)
          .where(
            input.id !== undefined
              ? eq(bookings.id, input.id)
              : eq(bookings.code, input.code ?? ''),
          );
        if (row === undefined) throw notFound('NOT_FOUND', 'Reserva não encontrada');
        return detail(tc, row);
      },
    }),
    defineTool({
      name: 'bookings_search',
      description:
        'Busca reservas por nome, e-mail ou código do cliente, status, sala e período (50 por página).',
      scope: 'read',
      input: adminBookingsQuerySchema,
      run: (tc, { cursor, ...filters }) => listAdminBookings(tc.deps.db, filters, cursor),
    }),
    defineTool({
      name: 'booking_create',
      description:
        'Cria uma reserva para um cliente (userId) em uma sala, data e horário; o cliente recebe o link de pagamento, ou a reserva é confirmada manualmente com justificativa.',
      scope: 'write',
      input: createShape.omit({ kind: true, expiresInHours: true }),
      run: async (tc, input) => {
        const parsed = staffCreateBookingSchema.parse({ ...input, kind: 'booking' });
        const { booking, paymentLink } = await staffCreateBooking(
          tc.deps,
          tc.ctx,
          staffOf(tc),
          parsed,
        );
        return { ...(await detail(tc, booking)), paymentLink };
      },
    }),
    defineTool({
      name: 'pre_reservation_create',
      description:
        'Cria uma pré-reserva que segura o horário por algumas horas (expiresInHours) e envia o link de pagamento ao cliente.',
      scope: 'write',
      input: createShape.omit({ kind: true, confirmManually: true, justification: true }),
      run: async (tc, input) => {
        const parsed = staffCreateBookingSchema.parse({ ...input, kind: 'pre_reservation' });
        const { booking, paymentLink } = await staffCreateBooking(
          tc.deps,
          tc.ctx,
          staffOf(tc),
          parsed,
        );
        return { ...(await detail(tc, booking)), paymentLink };
      },
    }),
    defineTool({
      name: 'booking_confirm_manual',
      description: 'Confirma manualmente uma reserva aguardando pagamento, com justificativa.',
      scope: 'write',
      input: bookingIdInput.extend(confirmManualSchema.shape),
      run: async (tc, input) =>
        detail(tc, await confirmManual(tc.deps, tc.ctx, input.bookingId, input.justification)),
    }),
    defineTool({
      name: 'booking_check_in',
      description: 'Registra o check-in do cliente em uma reserva do dia.',
      scope: 'write',
      input: bookingIdInput,
      run: async (tc, input) => detail(tc, await checkIn(tc.deps, tc.ctx, input.bookingId)),
    }),
    defineTool({
      name: 'booking_resend_payment_link',
      description: 'Gera e reenvia ao cliente o link de pagamento de uma reserva pendente.',
      scope: 'write',
      input: bookingIdInput,
      run: async (tc, input) => ({
        paymentLink: await resendPaymentLink(tc.deps, tc.ctx, input.bookingId),
      }),
    }),
    defineTool({
      name: 'booking_reschedule',
      description:
        'Reagenda uma reserva para outra data e horário (e opcionalmente outra sala), com exceção à política mediante justificativa.',
      scope: 'write',
      input: bookingIdInput.and(adminRescheduleSchema),
      run: async (tc, input) => {
        const booking = await bookingRow(tc, input.bookingId);
        const room = await getRoomById(tc.deps.db, input.roomId ?? booking.roomId);
        if (room === null) throw notFound('NOT_FOUND', 'Sala não encontrada');
        const outcome = await rescheduleBooking(tc.deps, tc.ctx, {
          bookingId: booking.id,
          actor: { kind: 'admin' },
          target: {
            roomSlug: room.slug,
            date: input.date,
            startMinute: input.startMinute,
            endMinute: input.endMinute,
          },
          exception: input.exception,
          differenceHandling: input.differenceHandling,
          justification: input.justification,
        });
        if (outcome.kind !== 'moved') throw new Error('admin reschedule never waits for payment');
        return { ...(await detail(tc, outcome.booking)), creditCents: outcome.creditCents };
      },
    }),
    defineTool({
      name: 'booking_cancel',
      description:
        'Cancela uma reserva pela clínica, devolvendo ao cliente o valor pago (resolution refund, credit ou minutes). Exige confirm: true.',
      scope: 'write',
      destructive: true,
      input: bookingIdInput.extend(adminCancelSchema.shape),
      preview: async (tc, input) => {
        const booking = await bookingRow(tc, input.bookingId);
        const [room] = await tc.deps.db
          .select({ name: rooms.name })
          .from(rooms)
          .where(eq(rooms.id, booking.roomId));
        const p = previewCancellation(booking, tc.deps.now(), 'clinic', tc.deps.registry);
        const minutes = p.minutesReturned > 0 ? ` e ${String(p.minutesReturned)} min` : '';
        return `Cancelar a reserva ${booking.code} (${room?.name ?? 'sala'}, ${formatDateTimeBR(booking.startsAt)}): o cliente recebe ${formatBRL(p.refundCents)}${minutes} de volta; ficam retidos ${formatBRL(p.retainedCents)}.`;
      },
      run: async (tc, input) => {
        const cancelled = await cancelBooking(tc.deps, tc.ctx, {
          bookingId: input.bookingId,
          actor: { kind: 'clinic' },
          reason: input.reason,
          resolution: input.resolution,
          justification: input.justification,
        });
        return detail(tc, cancelled);
      },
    }),
    defineTool({
      name: 'refund_create',
      description:
        'Reembolsa parte ou todo um pagamento aprovado (chargeId, amountCents em centavos) com motivo. Exige confirm: true.',
      scope: 'write',
      destructive: true,
      input: z.object({
        chargeId: idSchema,
        amountCents: z
          .number({ error: 'Informe o valor' })
          .int({ error: 'Informe o valor em centavos' })
          .positive({ error: 'Informe um valor maior que zero' }),
        reason: justificationSchema,
      }),
      preview: async (tc, input) => {
        const [charge] = await tc.deps.db
          .select()
          .from(charges)
          .where(eq(charges.id, input.chargeId));
        if (charge === undefined) throw notFound('NOT_FOUND', 'Pagamento não encontrado');
        return `Reembolsar ${formatBRL(input.amountCents)} do pagamento de ${formatBRL(charge.amountCents)} (já reembolsado: ${formatBRL(charge.refundedCents)}).`;
      },
      run: async (tc, input) => {
        const refund = await withTransaction(tc.deps.db, async (tx) => {
          const created = await requestRefund(tx, {
            chargeId: input.chargeId,
            amountCents: input.amountCents,
            reason: 'manual',
            ctx: tc.ctx,
          });
          await audit(tx, tc.ctx, {
            action: 'refund.request',
            entityType: 'refund',
            entityId: created.id,
            justification: input.reason,
            after: { chargeId: input.chargeId, amountCents: input.amountCents },
          });
          return created;
        });
        const processed = await processRefund(tc.deps, refund.id, tc.ctx);
        return {
          refundId: processed.id,
          status: processed.status,
          amountCents: processed.amountCents,
        };
      },
    }),
    defineTool({
      name: 'block_create',
      description: 'Bloqueia um horário em uma ou mais salas (manutenção, evento interno...).',
      scope: 'write',
      input: blockCreateSchema,
      run: async (tc, input) => ({
        items: await withTransaction(tc.deps.db, (tx) => createBlocks(tx, input, tc.ctx)),
      }),
    }),
    defineTool({
      name: 'block_remove',
      description: 'Remove um bloqueio de horário. Exige confirm: true.',
      scope: 'write',
      destructive: true,
      input: z.object({ blockId: idSchema }),
      preview: async (tc, input) => {
        const [block] = await tc.deps.db
          .select({ tag: blocks.tag, startsAt: blocks.startsAt, room: rooms.name })
          .from(blocks)
          .innerJoin(rooms, eq(rooms.id, blocks.roomId))
          .where(eq(blocks.id, input.blockId));
        if (block === undefined) throw notFound('NOT_FOUND', 'Bloqueio não encontrado');
        return `Remover o bloqueio "${block.tag}" da ${block.room} em ${formatDateTimeBR(block.startsAt)}; o horário volta a ficar disponível.`;
      },
      run: async (tc, input) => {
        await withTransaction(tc.deps.db, (tx) =>
          deleteBlock(tx, input.blockId, tc.ctx, tc.deps.now()),
        );
        return { removed: true };
      },
    }),
    defineTool({
      name: 'categories_list',
      description: 'Lista as categorias de preço (hora avulsa, blocos, pacotes e horários fixos).',
      scope: 'read',
      input: z.object({}),
      run: async (tc) => ({ items: await listCategories(tc.deps.db, tc.deps.registry) }),
    }),
    defineTool({
      name: 'policies_get',
      description: 'Mostra as políticas em vigor (sinal, saldo, cancelamento, reagendamento).',
      scope: 'read',
      input: z.object({}),
      run: (tc) => getPolicySettings(tc.deps.db),
    }),
  ];
}
