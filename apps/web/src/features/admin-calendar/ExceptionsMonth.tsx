import { holidayScopeLabel, type Holiday, type LocalDate } from '@bravo/core';
import { Trash2, TriangleAlert } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { MonthCalendarView, monthGridRange } from '../../components/calendar/MonthCalendarView';
import type { DayMarker, ScheduleEvent } from '../../components/calendar/schedule';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { cx, focusRing } from '../../components/ui/cx';
import { Alert, Spinner } from '../../components/ui/Feedback';
import { Icon } from '../../components/ui/Icon';
import { useToast } from '../../components/ui/Toast';
import { ApiError } from '../../lib/api';
import { affectedBookingsOf, messageOf } from '../../lib/api-errors';
import { formatLocalDateBR, formatMinuteRange, formatWeekdays } from '../../lib/format';
import { BlockModal, type BlockDefaults } from '../admin-blocks/BlockModal';
import {
  useBlockRecurrences,
  useBlocks,
  useClosedDays,
  useDeleteClosedDay,
  useDeleteHoliday,
  useDeleteRecurrence,
  useHolidays,
  useImportHolidays,
  useUpdateHoliday,
} from '../calendar/api';
import { useRooms } from '../catalog/api';
import { AffectedBookingsModal } from './AffectedBookingsModal';
import { ClosedDayModal } from './ClosedDayModal';
import { HolidayForm } from './HolidayForm';

const plural = (n: number, one: string, many: string) => `${String(n)} ${n === 1 ? one : many}`;

function HolidayRow({ holiday }: { holiday: Holiday }) {
  const update = useUpdateHoliday(holiday.id);
  const remove = useDeleteHoliday();
  const [conflict, setConflict] = useState<{
    message: string;
    bookings: NonNullable<ReturnType<typeof affectedBookingsOf>>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggle = (isClosed: boolean) => {
    setError(null);
    update.mutate(
      { isClosed },
      {
        onError: (caught) => {
          const bookings = affectedBookingsOf(caught);
          if (bookings) {
            setConflict({ message: caught instanceof ApiError ? caught.message : '', bookings });
            return;
          }
          setError(messageOf(caught, 'Não foi possível alterar o feriado.'));
        },
      },
    );
  };

  return (
    <li className="space-y-1 border-b border-hairline py-space-sm last:border-b-0">
      <div className="flex flex-wrap items-center gap-space-sm font-small text-small">
        <span className="w-12 shrink-0 text-ink-muted">
          {formatLocalDateBR(holiday.date).slice(0, 5)}
        </span>
        <span className="font-medium text-ink">{holiday.name}</span>
        <Badge tone="neutral">{holidayScopeLabel[holiday.scope]}</Badge>
        {holiday.alert ? (
          <Icon
            as={TriangleAlert}
            size={18}
            label="Feriado nos próximos 30 dias"
            className="text-accent"
          />
        ) : null}
        <label className="ml-auto flex items-center gap-space-xs text-ink">
          <input
            type="checkbox"
            checked={holiday.isClosed}
            disabled={update.isPending}
            onChange={(event) => {
              toggle(event.target.checked);
            }}
            className={cx('h-4 w-4 accent-emerald', focusRing)}
          />
          <span>
            <span className="sr-only">{holiday.name}: </span>Fechado
          </span>
        </label>
        {holiday.source === 'manual' ? (
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Remover feriado ${holiday.name}`}
            loading={remove.isPending}
            onClick={() => {
              remove.mutate(holiday.id);
            }}
          >
            <Icon as={Trash2} size={16} />
          </Button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="font-caption text-caption text-danger">
          {error}
        </p>
      ) : null}
      <AffectedBookingsModal
        open={conflict !== null}
        onClose={() => {
          setConflict(null);
        }}
        title="Reservas afetadas"
        message={
          conflict?.message ||
          'Existem reservas neste dia. Realoque ou cancele antes de fechar o feriado.'
        }
        bookings={conflict?.bookings ?? []}
      />
    </li>
  );
}

export interface ExceptionsMonthProps {
  /** Any date of the displayed month. */
  date: LocalDate;
  today: LocalDate;
  onDateChange: (date: LocalDate) => void;
}

/**
 * Monthly exceptions view (NUC-52): closed days, holidays with scope and alert, recurring blocks,
 * with the actions to open/close a holiday, add or import holidays, close a date and block time.
 */
export function ExceptionsMonth({ date, today, onDateChange }: ExceptionsMonthProps) {
  const year = Number(date.slice(0, 4));
  const range = monthGridRange(date);
  const holidays = useHolidays(year);
  const closedDays = useClosedDays(range.from, range.to);
  const blocks = useBlocks({ from: range.from, to: range.to });
  const recurrences = useBlockRecurrences();
  const rooms = useRooms();
  const importHolidays = useImportHolidays();
  const removeClosedDay = useDeleteClosedDay();
  const removeRecurrence = useDeleteRecurrence();
  const { toast } = useToast();

  const [closing, setClosing] = useState<string | null>(null);
  const [addingHoliday, setAddingHoliday] = useState(false);
  const [blocking, setBlocking] = useState<BlockDefaults | null>(null);

  const roomName = useCallback(
    (id: string) => rooms.data?.items.find((r) => r.id === id)?.name ?? 'Sala',
    [rooms.data],
  );

  const events = useMemo<ScheduleEvent[]>(
    () =>
      (blocks.data?.items ?? []).map((block) => ({
        id: block.id,
        kind: 'block',
        startsAt: block.startsAt,
        endsAt: block.endsAt,
        title: `${block.tag} · ${roomName(block.roomId)}`,
      })),
    [blocks.data, roomName],
  );
  const holidayMarkers: DayMarker[] = (holidays.data?.items ?? []).map((h) => ({
    date: h.date,
    label: h.name,
  }));
  const closedMarkers: DayMarker[] = (closedDays.data?.items ?? []).map((c) => ({
    date: c.date,
    label: c.reason ?? 'Fechado',
  }));

  const runImport = () => {
    importHolidays.mutate(
      { year },
      {
        onSuccess: ({ inserted, updated }) => {
          toast({
            message: `Importação concluída: ${plural(inserted, 'novo', 'novos')}, ${plural(updated, 'atualizado', 'atualizados')}.`,
          });
        },
        onError: (error) => {
          toast({ message: messageOf(error, 'Não foi possível importar os feriados.') });
        },
      },
    );
  };

  return (
    <section aria-labelledby="exceptions-title" className="space-y-space-md">
      <div className="flex flex-wrap items-center justify-between gap-space-sm">
        <h2 id="exceptions-title" className="font-heading text-heading-mobile text-ink">
          Exceções e bloqueios
        </h2>
        <div className="flex flex-wrap gap-space-sm">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setClosing('');
            }}
          >
            Fechar uma data
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setAddingHoliday(true);
            }}
          >
            Novo feriado
          </Button>
          <Button
            variant="secondary"
            size="sm"
            loading={importHolidays.isPending}
            onClick={runImport}
          >
            {`Importar feriados de ${String(year)}`}
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setBlocking({});
            }}
          >
            Bloquear
          </Button>
        </div>
      </div>

      <MonthCalendarView
        date={date}
        today={today}
        events={events}
        holidays={holidayMarkers}
        closedDays={closedMarkers}
        onNavigate={(next) => {
          onDateChange(next.date);
        }}
        onSelectDate={(selected) => {
          setClosing(selected);
        }}
      />
      <p className="font-caption text-caption text-ink-muted">
        Clique no número de um dia para fechá-lo.
      </p>

      {holidays.isError || closedDays.isError ? (
        <Alert tone="error">Não foi possível carregar as exceções do calendário.</Alert>
      ) : null}
      {holidays.isPending ? <Spinner label="Carregando feriados" /> : null}

      <div className="grid gap-space-lg lg:grid-cols-2">
        <section
          aria-labelledby="holidays-title"
          className="space-y-space-xs rounded-lg bg-surface-raised p-space-lg shadow-card"
        >
          <h3 id="holidays-title" className="font-small text-small font-medium text-ink">
            Feriados de {year}
          </h3>
          {holidays.data && holidays.data.items.length === 0 ? (
            <p className="font-small text-small text-ink-muted">
              Nenhum feriado cadastrado neste ano.
            </p>
          ) : null}
          <ul className="max-h-96 overflow-y-auto">
            {(holidays.data?.items ?? []).map((holiday) => (
              <HolidayRow key={holiday.id} holiday={holiday} />
            ))}
          </ul>
        </section>

        <div className="space-y-space-lg rounded-lg bg-surface-raised p-space-lg shadow-card">
          <section aria-labelledby="closed-title" className="space-y-space-xs">
            <h3 id="closed-title" className="font-small text-small font-medium text-ink">
              Dias fechados
            </h3>
            {closedDays.data && closedDays.data.items.length === 0 ? (
              <p className="font-small text-small text-ink-muted">
                Nenhum dia fechado neste período.
              </p>
            ) : null}
            <ul>
              {(closedDays.data?.items ?? []).map((closed) => (
                <li
                  key={closed.id}
                  className="flex flex-wrap items-center gap-space-sm border-b border-hairline py-space-sm font-small text-small last:border-b-0"
                >
                  <span className="text-ink-muted">{formatLocalDateBR(closed.date)}</span>
                  <span className="text-ink">{closed.roomName ?? 'Toda a clínica'}</span>
                  {closed.reason ? <span className="text-ink-muted">{closed.reason}</span> : null}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto"
                    aria-label={`Reabrir ${formatLocalDateBR(closed.date)}`}
                    loading={removeClosedDay.isPending}
                    onClick={() => {
                      removeClosedDay.mutate(closed.id);
                    }}
                  >
                    Reabrir
                  </Button>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="recurrences-title" className="space-y-space-xs">
            <h3 id="recurrences-title" className="font-small text-small font-medium text-ink">
              Bloqueios recorrentes
            </h3>
            {recurrences.data && recurrences.data.items.filter((r) => r.active).length === 0 ? (
              <p className="font-small text-small text-ink-muted">Nenhum bloqueio recorrente.</p>
            ) : null}
            <ul>
              {(recurrences.data?.items ?? [])
                .filter((rule) => rule.active)
                .map((rule) => (
                  <li
                    key={rule.id}
                    className="flex flex-wrap items-center gap-space-sm border-b border-hairline py-space-sm font-small text-small last:border-b-0"
                  >
                    <span className="font-medium text-ink">{rule.tag}</span>
                    <span className="text-ink-muted">
                      {roomName(rule.roomId)} · {formatWeekdays(rule.weekdays, false)} ·{' '}
                      {formatMinuteRange(rule.startMinute, rule.endMinute)}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-danger ml-auto"
                      aria-label={`Remover bloqueio ${rule.tag}`}
                      loading={removeRecurrence.isPending}
                      onClick={() => {
                        removeRecurrence.mutate(rule.id);
                      }}
                    >
                      Remover
                    </Button>
                  </li>
                ))}
            </ul>
          </section>
        </div>
      </div>

      <ClosedDayModal
        open={closing !== null}
        onClose={() => {
          setClosing(null);
        }}
        {...(closing ? { defaultDate: closing } : {})}
      />
      <HolidayForm
        open={addingHoliday}
        onClose={() => {
          setAddingHoliday(false);
        }}
      />
      <BlockModal
        open={blocking !== null}
        onClose={() => {
          setBlocking(null);
        }}
        {...(blocking ? { defaults: blocking } : {})}
      />
    </section>
  );
}
