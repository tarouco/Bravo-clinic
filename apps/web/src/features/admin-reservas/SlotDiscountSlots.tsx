import { utcToLocal, type LocalDate } from '@bravo/core';
import { Percent, X } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import type { OverlayMarker } from '../../components/calendar/schedule';
import { useToast } from '../../components/ui/Toast';
import { messageOf } from '../../lib/api-errors';
import { FreeSlotMenuItem } from '../admin-bookings/FreeSlotMenu';
import { useRooms } from '../catalog/api';
import { useRemoveSlotDiscount, useSlotDiscounts } from '../purchases/api';
import type { SlotDiscount } from '../purchases/types';
import { SlotDiscountDialog } from './SlotDiscountDialog';
import {
  closeSlotDiscountDialog,
  openSlotDiscountDialog,
  useSlotDiscountRequest,
} from './slot-discount-request';

/** A discount as a local date and minute range; it never crosses midnight, so 00:00 closes the day. */
function localRange(discount: SlotDiscount): {
  date: LocalDate;
  startMinute: number;
  endMinute: number;
} {
  const start = utcToLocal(new Date(discount.startsAt));
  const end = utcToLocal(new Date(discount.endsAt));
  const endMinute = end.date !== start.date && end.minuteOfDay === 0 ? 1440 : end.minuteOfDay;
  return { date: start.date, startMinute: start.minuteOfDay, endMinute };
}

export interface FreeSlotActionProps {
  roomId: string;
  date: LocalDate;
  startMinute: number;
  endMinute: number;
  /** Closes the selection modal the menu may be shown in. */
  onDone?: () => void;
}

/**
 * Slot `admin.calendar.freeSlotActions`: "Aplicar desconto (%)" for the hovered or dragged range,
 * and "Remover desconto" when the slot already carries an active discount (REC-133, REC-137).
 */
export function SlotDiscountAction({
  roomId,
  date,
  startMinute,
  endMinute,
  onDone,
}: FreeSlotActionProps) {
  const { toast } = useToast();
  const discounts = useSlotDiscounts({ from: date, to: date, roomId });
  const remove = useRemoveSlotDiscount();

  const covering = (discounts.data?.items ?? []).find((discount) => {
    if (discount.roomId !== roomId || discount.consumed) return false;
    const range = localRange(discount);
    return range.date === date && range.startMinute < endMinute && startMinute < range.endMinute;
  });

  return (
    <>
      <FreeSlotMenuItem
        icon={Percent}
        onClick={() => {
          openSlotDiscountDialog({ roomId, date, startMinute, endMinute });
          onDone?.();
        }}
      >
        Aplicar desconto (%)
      </FreeSlotMenuItem>
      {covering ? (
        <FreeSlotMenuItem
          icon={X}
          onClick={() => {
            remove.mutate(covering.id, {
              onSuccess: () => {
                toast({ message: 'Desconto removido.' });
              },
              onError: (error) => {
                toast({ message: messageOf(error, 'Não foi possível remover o desconto.') });
              },
            });
            onDone?.();
          }}
        >
          Remover desconto
        </FreeSlotMenuItem>
      ) : null}
    </>
  );
}

export interface OverlayProps {
  from: LocalDate;
  to: LocalDate;
  roomId: string | null;
  reportMarkers: (key: string, markers: OverlayMarker[]) => void;
}

/**
 * Slot `admin.calendar.overlays`: marks the free discounted slots of the shown range with
 * "−{p}%" (REC-137) and hosts the discount dialog the free-slot action opens.
 */
export function SlotDiscountOverlay({ from, to, roomId, reportMarkers }: OverlayProps) {
  const rooms = useRooms();
  const discounts = useSlotDiscounts({ from, to, ...(roomId ? { roomId } : {}) });
  const request = useSlotDiscountRequest();

  const markers = useMemo<OverlayMarker[]>(() => {
    const roomName = (id: string) => rooms.data?.items.find((r) => r.id === id)?.name;
    return (discounts.data?.items ?? [])
      .filter((discount) => !discount.consumed)
      .map((discount) => {
        const range = localRange(discount);
        const name = roomId ? undefined : roomName(discount.roomId);
        return {
          ...range,
          label: `−${String(discount.percent)}%${name ? ` · ${name}` : ''}`,
        };
      });
  }, [discounts.data, rooms.data, roomId]);

  useEffect(() => {
    reportMarkers('slot-discounts', markers);
    return () => {
      reportMarkers('slot-discounts', []);
    };
  }, [markers, reportMarkers]);

  // A dialog left open must not outlive the calendar.
  useEffect(() => closeSlotDiscountDialog, []);

  return request ? (
    <SlotDiscountDialog prefill={request} onClose={closeSlotDiscountDialog} />
  ) : null;
}
