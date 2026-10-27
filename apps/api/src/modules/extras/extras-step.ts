import { ceilDiv, extrasAddonSchema, formatBRL, type Cents } from '@bravo/core';
import { inArray } from 'drizzle-orm';
import { bookingExtraItems, extraServices } from '../../db/schema';
import type { CheckoutStep, QuoteDraft } from '../../extensions/registry';
import { AppError, type ErrorDetail } from '../../lib/errors';

// Checkout add-on `extras` (nucleo R6, order 300; GES-88, GES-89): online-sold extra services are
// priced at their unit price × quantity and added to the booking total before the deposit/balance
// split; `persist` freezes each line in `booking_extra_items`.

/** One priced line, kept in `draft.extras[].ref` and shown in `Quote.extensions.extras`. */
export interface ExtraLine {
  serviceId: string;
  serviceName: string;
  unit: 'hour' | 'project';
  quantity: number;
  unitPriceCents: Cents;
  amountCents: Cents;
}

const invalid = (details: ErrorDetail[]) =>
  new AppError(422, 'VALIDATION_FAILED', 'Dados inválidos', details);

function lineLabel(line: ExtraLine): string {
  return line.unit === 'hour'
    ? `${line.serviceName} · ${String(line.quantity)}h × ${formatBRL(line.unitPriceCents)}`
    : line.serviceName;
}

const isExtraLine = (ref: unknown): ref is ExtraLine =>
  typeof ref === 'object' && ref !== null && 'serviceId' in ref && 'unitPriceCents' in ref;

export const extrasStep: CheckoutStep = {
  name: 'extras',
  order: 300,

  async apply(ctx, draft): Promise<QuoteDraft> {
    const raw = ctx.request.addons?.['extras'];
    if (raw === undefined) return draft;
    const parsed = extrasAddonSchema.safeParse(raw);
    if (!parsed.success) {
      throw invalid(
        parsed.error.issues.map((issue) => ({
          path: ['addons', 'extras', ...issue.path.map(String)].join('.'),
          message: issue.message,
        })),
      );
    }
    const requested = parsed.data;
    if (requested.length === 0) return draft;
    // Extras are sold with a paid booking only: the package step zeroes a package booking's total.
    if (draft.paymentMode === 'package') {
      throw invalid([
        { path: 'addons.extras', message: 'Serviços extras não podem ser pagos com o pacote' },
      ]);
    }

    const rows = await ctx.db
      .select()
      .from(extraServices)
      .where(
        inArray(
          extraServices.id,
          requested.map((r) => r.serviceId),
        ),
      );
    const maxHours = Math.max(1, ceilDiv(ctx.endMinute - ctx.startMinute, 60));
    const details: ErrorDetail[] = [];
    const lines: ExtraLine[] = [];
    requested.forEach((wanted, index) => {
      const service = rows.find((r) => r.id === wanted.serviceId);
      if (
        service === undefined ||
        service.status !== 'active' ||
        service.saleMode !== 'online' ||
        service.referencePriceCents === null
      ) {
        details.push({
          path: `addons.extras.${String(index)}.serviceId`,
          message: 'Serviço indisponível para compra online',
        });
        return;
      }
      const unit = service.unit as ExtraLine['unit'];
      const max = unit === 'hour' ? maxHours : 1;
      if (wanted.quantity > max) {
        details.push({
          path: `addons.extras.${String(index)}.quantity`,
          message:
            unit === 'hour'
              ? `Escolha de 1 a ${String(max)} ${max === 1 ? 'hora' : 'horas'}`
              : 'Este serviço é vendido por projeto (quantidade 1)',
        });
        return;
      }
      lines.push({
        serviceId: service.id,
        serviceName: service.name,
        unit,
        quantity: wanted.quantity,
        unitPriceCents: service.referencePriceCents,
        amountCents: service.referencePriceCents * wanted.quantity,
      });
    });
    if (details.length > 0) throw invalid(details);

    return {
      ...draft,
      extras: [
        ...draft.extras,
        ...lines.map((line) => ({
          label: lineLabel(line),
          amountCents: line.amountCents,
          ref: line,
        })),
      ],
      extensions: { ...draft.extensions, extras: lines },
    };
  },

  /** Freezes name, unit and unit price of each line with the booking (GES-88). */
  async persist(tx, booking, draft) {
    const lines = draft.extras.map((e) => e.ref).filter(isExtraLine);
    if (lines.length === 0) return;
    await tx.insert(bookingExtraItems).values(
      lines.map((line) => ({
        bookingId: booking.id,
        serviceId: line.serviceId,
        serviceName: line.serviceName,
        unit: line.unit,
        quantity: line.quantity,
        unitPriceCents: line.unitPriceCents,
        amountCents: line.amountCents,
      })),
    );
  },
};
