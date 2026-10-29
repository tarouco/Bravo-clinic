import {
  BOOKING_STATUSES,
  bookingStatusLabel,
  utcToLocal,
  type BookingStatus,
  type LocalDate,
} from '@bravo/core';
import { Plus } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { MonthCalendarView, monthGridRange } from '../../../components/calendar/MonthCalendarView';
import {
  TONE_CLASSES,
  toneOfStatus,
  type DayMarker,
  type FreeSlot,
  type OverlayMarker,
  type ScheduleEvent,
  type ScheduleTone,
} from '../../../components/calendar/schedule';
import { WeekCalendar, weekRange } from '../../../components/calendar/WeekCalendar';
import { Button } from '../../../components/ui/Button';
import { Chip } from '../../../components/ui/Chip';
import { cx } from '../../../components/ui/cx';
import { Alert, Spinner } from '../../../components/ui/Feedback';
import { Select } from '../../../components/ui/form';
import { HoverCard } from '../../../components/ui/HoverCard';
import { Icon } from '../../../components/ui/Icon';
import { Modal } from '../../../components/ui/Modal';
import { useToast } from '../../../components/ui/Toast';
import { Slot } from '../../../extensions/slots';
import { BlockModal, type BlockDefaults } from '../../../features/admin-blocks/BlockModal';
import {
  CancelBookingDialog,
  ConfirmManualDialog,
  RescheduleBookingDialog,
  useQuickActions,
  type BookingActionKind,
  type CalendarBooking,
} from '../../../features/admin-bookings/BookingActions';
import { BookingPopup } from '../../../features/admin-bookings/BookingPopup';
import {
  CreateBookingDrawer,
  type CreateRequest,
} from '../../../features/admin-bookings/CreateBookingDrawer';
import { FreeSlotMenu, type CreateKind } from '../../../features/admin-bookings/FreeSlotMenu';
import { useSession } from '../../../features/auth/useSession';
import { useCalendarEvents, useDeleteBlock } from '../../../features/calendar/api';
import { useCatalog, useRooms } from '../../../features/catalog/api';
import { messageOf } from '../../../lib/api-errors';
import { bookingWhen } from '../../../lib/booking-time';
import { formatMinuteRange } from '../../../lib/format';

type View = 'week' | 'month';

interface Filters {
  roomId: string;
  status: string;
  categoryId: string;
}

const LEGEND: { label: string; tone: ScheduleTone }[] = [
  { label: 'Confirmada ou quitada', tone: 'confirmed' },
  { label: 'Aguardando pgto ou pré-reserva', tone: 'pending' },
  { label: 'Cancelada ou no-show', tone: 'attention' },
  { label: 'Concluída ou expirada', tone: 'neutral' },
  { label: 'Bloqueio', tone: 'block' },
];

function FreeSlotTrigger({
  slot,
  roomId,
  onCreate,
  onBlock,
}: {
  slot: FreeSlot;
  roomId: string;
  onCreate: (kind: CreateKind, slot: FreeSlot) => void;
  onBlock: (slot: FreeSlot) => void;
}) {
  const label = `Horário livre ${formatMinuteRange(slot.startMinute, slot.endMinute)}`;
  return (
    <HoverCard
      label={label}
      trigger={(props) => (
        <button
          type="button"
          tabIndex={-1}
          aria-label={label}
          className="absolute inset-0 flex items-center justify-center text-accent opacity-0 hover:opacity-100 focus:opacity-100"
          {...props}
        >
          <Icon as={Plus} size={14} />
        </button>
      )}
    >
      <FreeSlotMenu slot={slot} roomId={roomId} onCreate={onCreate} onBlock={onBlock} />
    </HoverCard>
  );
}

/** Week or month calendar of every booking with hover popups and free-slot actions (NUC-158..160). */
export function ReservationsCalendar() {
  const { session } = useSession();
  const role = session?.role ?? 'reception';
  const today = utcToLocal(new Date()).date;
  const { toast } = useToast();

  const [view, setView] = useState<View>('week');
  const [date, setDate] = useState<LocalDate>(today);
  const [filters, setFilters] = useState<Filters>({ roomId: '', status: '', categoryId: '' });
  const [dialog, setDialog] = useState<{
    kind: 'confirm' | 'reschedule' | 'cancel';
    booking: CalendarBooking;
  } | null>(null);
  const [blocking, setBlocking] = useState<BlockDefaults | null>(null);
  const [create, setCreate] = useState<CreateRequest | null>(null);
  const [selected, setSelected] = useState<FreeSlot | null>(null);
  const [markers, setMarkers] = useState<Record<string, OverlayMarker[]>>({});

  const rooms = useRooms();
  const catalog = useCatalog();
  const { resend, checkIn } = useQuickActions();
  const removeBlock = useDeleteBlock();

  const range = view === 'week' ? weekRange(date) : monthGridRange(date);
  const events = useCalendarEvents({
    from: range.from,
    to: range.to,
    ...(filters.roomId ? { roomId: filters.roomId } : {}),
    ...(filters.status ? { status: filters.status as BookingStatus } : {}),
    ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
  });
  const data = events.data;

  const reportMarkers = useCallback((key: string, next: OverlayMarker[]) => {
    setMarkers((current) => ({ ...current, [key]: next }));
  }, []);

  const handleAction = (kind: BookingActionKind, booking: CalendarBooking) => {
    if (kind === 'resend') resend.mutate(booking.id);
    else if (kind === 'checkin') checkIn.mutate(booking.id);
    else setDialog({ kind, booking });
  };

  const startCreate = (kind: CreateKind, slot?: FreeSlot) => {
    setSelected(null);
    setCreate({
      kind,
      ...(slot && filters.roomId
        ? {
            roomId: filters.roomId,
            date: slot.date,
            startMinute: slot.startMinute,
            endMinute: slot.endMinute,
          }
        : {}),
    });
  };

  const startBlock = (slot?: FreeSlot) => {
    setSelected(null);
    setBlocking(
      slot
        ? {
            ...(filters.roomId ? { roomIds: [filters.roomId] } : {}),
            date: slot.date,
            startMinute: slot.startMinute,
            endMinute: slot.endMinute,
          }
        : {},
    );
  };

  const bookingsById = useMemo(() => new Map((data?.bookings ?? []).map((b) => [b.id, b])), [data]);
  const blocksById = useMemo(() => new Map((data?.blocks ?? []).map((b) => [b.id, b])), [data]);
  const roomName = (id: string) => rooms.data?.items.find((r) => r.id === id)?.name ?? 'Sala';

  const scheduleEvents = useMemo<ScheduleEvent[]>(
    () => [
      ...(data?.bookings ?? []).map((b): ScheduleEvent => ({
        id: b.id,
        kind: 'booking',
        startsAt: b.startsAt,
        endsAt: b.endsAt,
        cleanupUntil: b.cleanupUntil,
        title: `${b.firstName} · ${b.roomName}`,
        tone: toneOfStatus(b.status),
      })),
      ...(data?.blocks ?? []).map((b): ScheduleEvent => ({
        id: b.id,
        kind: 'block',
        startsAt: b.startsAt,
        endsAt: b.endsAt,
        title: b.tag,
      })),
    ],
    [data],
  );
  const holidays: DayMarker[] = (data?.holidays ?? []).map((h) => ({
    date: h.date,
    label: h.name,
  }));
  const closedDays: DayMarker[] = (data?.closedDays ?? []).map((c) => ({
    date: c.date,
    label: c.reason ?? 'Fechado',
  }));
  const overlayMarkers = Object.values(markers).flat();

  const renderEventCard = (event: ScheduleEvent) => {
    const booking = bookingsById.get(event.id);
    if (booking) return <BookingPopup booking={booking} role={role} onAction={handleAction} />;
    const block = blocksById.get(event.id);
    if (!block) return null;
    return (
      <div className="space-y-space-sm font-small text-small text-ink">
        <p className="font-medium">{block.tag}</p>
        <p className="text-ink-muted">
          {roomName(block.roomId)} · {bookingWhen(block.startsAt, block.endsAt)}
        </p>
        <Button
          className="text-danger"
          size="sm"
          variant="secondary"
          loading={removeBlock.isPending}
          onClick={() => {
            removeBlock.mutate(block.id, {
              onSuccess: () => {
                toast({ message: 'Bloqueio removido.' });
              },
              onError: (error) => {
                toast({ message: messageOf(error, 'Não foi possível remover o bloqueio.') });
              },
            });
          }}
        >
          Remover bloqueio
        </Button>
      </div>
    );
  };

  const setFilter = (key: keyof Filters) => (event: { target: { value: string } }) => {
    setFilters((current) => ({ ...current, [key]: event.target.value }));
  };

  const categories = [
    ...(catalog.data?.hourly ?? []).map((c) => ({ id: c.id, name: c.name })),
    ...(catalog.data?.blocks ?? []).map((c) => ({ id: c.id, name: c.name })),
  ];
  const singleRoom = filters.roomId !== '';

  const shared = {
    today,
    events: scheduleEvents,
    holidays,
    closedDays,
    renderEventCard,
  } as const;

  return (
    <div className="space-y-space-md">
      <div className="flex flex-wrap items-end gap-space-md">
        <Select label="Sala" value={filters.roomId} onChange={setFilter('roomId')}>
          <option value="">Todas as salas</option>
          {(rooms.data?.items ?? []).map((room) => (
            <option key={room.id} value={room.id}>
              {room.name}
            </option>
          ))}
        </Select>
        <Select label="Status" value={filters.status} onChange={setFilter('status')}>
          <option value="">Todos os status</option>
          {BOOKING_STATUSES.map((status) => (
            <option key={status} value={status}>
              {bookingStatusLabel[status]}
            </option>
          ))}
        </Select>
        <Select label="Categoria" value={filters.categoryId} onChange={setFilter('categoryId')}>
          <option value="">Todas as categorias</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </Select>
        <div role="group" aria-label="Visualização" className="bv-chips mb-1">
          {(
            [
              ['week', 'Semana'],
              ['month', 'Mês'],
            ] as const
          ).map(([id, label]) => (
            <Chip
              key={id}
              selected={view === id}
              onClick={() => {
                setView(id);
              }}
            >
              {label}
            </Chip>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-space-sm">
        <ul aria-label="Legenda de status" className="flex flex-wrap gap-x-space-md gap-y-space-xs">
          {LEGEND.map((item) => (
            <li
              key={item.label}
              className="flex items-center gap-space-xs font-caption text-caption text-ink-muted"
            >
              <span
                aria-hidden="true"
                className={cx('inline-block h-3 w-3 rounded-pill border', TONE_CLASSES[item.tone])}
              />
              {item.label}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-space-sm">
          <Button
            size="sm"
            onClick={() => {
              startCreate('booking');
            }}
          >
            Criar reserva
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              startCreate('pre_reservation');
            }}
          >
            Criar pré-reserva
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              startBlock();
            }}
          >
            Bloquear
          </Button>
        </div>
      </div>

      <Slot
        name="admin.calendar.overlays"
        props={{ from: range.from, to: range.to, roomId: filters.roomId || null, reportMarkers }}
      />

      {events.isPending ? <Spinner label="Carregando reservas" /> : null}
      {events.isError ? (
        <Alert tone="error">
          {messageOf(events.error, 'Não foi possível carregar as reservas agora.')}
        </Alert>
      ) : null}
      {!singleRoom && view === 'week' ? (
        <p className="font-caption text-caption text-ink-muted">
          Escolha uma sala para criar reservas e bloqueios direto pelos horários livres.
        </p>
      ) : null}

      {view === 'week' ? (
        <WeekCalendar
          {...shared}
          date={date}
          markers={overlayMarkers}
          {...(singleRoom
            ? {
                renderFreeSlot: (slot: FreeSlot) => (
                  <FreeSlotTrigger
                    slot={slot}
                    roomId={filters.roomId}
                    onCreate={startCreate}
                    onBlock={startBlock}
                  />
                ),
                onRangeSelect: setSelected,
              }
            : {})}
          onNavigate={(next) => {
            setDate(next.date);
          }}
        />
      ) : (
        <MonthCalendarView
          {...shared}
          date={date}
          onNavigate={(next) => {
            setDate(next.date);
          }}
          onSelectDate={(selectedDate) => {
            setDate(selectedDate);
            setView('week');
          }}
        />
      )}

      <Modal
        open={selected !== null}
        onClose={() => {
          setSelected(null);
        }}
        title={
          selected
            ? `Horário selecionado ${formatMinuteRange(selected.startMinute, selected.endMinute)}`
            : 'Horário selecionado'
        }
      >
        {selected ? (
          <FreeSlotMenu
            slot={selected}
            roomId={filters.roomId}
            onCreate={startCreate}
            onBlock={startBlock}
            onSlotAction={() => {
              setSelected(null);
            }}
          />
        ) : null}
      </Modal>

      <CreateBookingDrawer
        request={create}
        onClose={() => {
          setCreate(null);
        }}
      />
      <BlockModal
        open={blocking !== null}
        onClose={() => {
          setBlocking(null);
        }}
        {...(blocking ? { defaults: blocking } : {})}
      />
      {dialog?.kind === 'confirm' ? (
        <ConfirmManualDialog
          booking={dialog.booking}
          onClose={() => {
            setDialog(null);
          }}
        />
      ) : null}
      {dialog?.kind === 'reschedule' ? (
        <RescheduleBookingDialog
          booking={dialog.booking}
          onClose={() => {
            setDialog(null);
          }}
        />
      ) : null}
      {dialog?.kind === 'cancel' ? (
        <CancelBookingDialog
          booking={dialog.booking}
          onClose={() => {
            setDialog(null);
          }}
        />
      ) : null}
    </div>
  );
}
