import { CalendarPlus, CalendarClock, Ban } from 'lucide-react';
import type { ReactNode } from 'react';
import type { FreeSlot } from '../../components/calendar/schedule';
import { cx, focusRing } from '../../components/ui/cx';
import { Icon } from '../../components/ui/Icon';
import { Slot } from '../../extensions/slots';
import { formatMinuteRange } from '../../lib/format';

export type CreateKind = 'booking' | 'pre_reservation';

export interface FreeSlotMenuProps {
  slot: FreeSlot;
  /** Room the calendar is filtered to; actions apply to it. */
  roomId: string;
  onCreate: (kind: CreateKind, slot: FreeSlot) => void;
  onBlock: (slot: FreeSlot) => void;
  /** Called when an action of another feature, from the slot, is chosen (closes a selection modal). */
  onSlotAction?: () => void;
}

const item =
  'flex w-full items-center gap-space-sm rounded-pill px-space-sm py-space-xs text-left font-small text-small text-ink hover:bg-glass-hover';

/** One row of the menu; other features reuse it for the actions they register in the slot. */
export function FreeSlotMenuItem({
  icon,
  children,
  onClick,
}: {
  icon: typeof Ban;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button type="button" role="menuitem" onClick={onClick} className={cx(item, focusRing)}>
      <Icon as={icon} size={16} />
      {children}
    </button>
  );
}

/**
 * Menu of a free slot (NUC-160): "Criar pré-reserva", "Criar reserva", "Bloquear" and the actions
 * other features register in the `admin.calendar.freeSlotActions` slot.
 */
export function FreeSlotMenu({ slot, roomId, onCreate, onBlock, onSlotAction }: FreeSlotMenuProps) {
  return (
    // The card sits inside a calendar cell: its pointer events must not start a drag selection.
    <div
      role="menu"
      aria-label={`Horário livre ${formatMinuteRange(slot.startMinute, slot.endMinute)}`}
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
      className="space-y-space-xs"
    >
      <FreeSlotMenuItem
        icon={CalendarClock}
        onClick={() => {
          onCreate('pre_reservation', slot);
        }}
      >
        Criar pré-reserva
      </FreeSlotMenuItem>
      <FreeSlotMenuItem
        icon={CalendarPlus}
        onClick={() => {
          onCreate('booking', slot);
        }}
      >
        Criar reserva
      </FreeSlotMenuItem>
      <FreeSlotMenuItem
        icon={Ban}
        onClick={() => {
          onBlock(slot);
        }}
      >
        Bloquear
      </FreeSlotMenuItem>
      <Slot
        name="admin.calendar.freeSlotActions"
        props={{
          roomId,
          date: slot.date,
          startMinute: slot.startMinute,
          endMinute: slot.endMinute,
          onDone: onSlotAction,
        }}
      />
    </div>
  );
}
