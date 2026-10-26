import { addDays, utcToLocal, type AvailabilityMonth, type LocalDate } from '@bravo/core';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MonthCalendar } from '../../components/calendar/MonthCalendar';
import { Button } from '../../components/ui/Button';
import { cx, focusRing } from '../../components/ui/cx';
import { Alert, Spinner } from '../../components/ui/Feedback';
import { datesOfMonth, monthOf } from '../../lib/calendar-dates';
import { formatLocalDateBR } from '../../lib/format';
import { messageOf } from '../../lib/api-errors';
import { useRooms } from '../catalog/api';
import { useOccurrenceCheck } from './api';
import { formatOccurrence, formatPeriodPrice, formatWeekdayDate } from './format';

/** URL params that keep the chosen room and start date across login and refresh (REC-157). */
export const PICKER_PARAMS = { room: 'roomId', baseOn: 'baseOn' } as const;

/** Furthest start date offered; the API enforces `calendar.max_advance_days` (REC-11). */
const MAX_ADVANCE_DAYS = 90;

export interface FixedSchedulePickerProps {
  categoryId: string;
  /** Price of one occurrence; falls back to the period price divided by the count. */
  pricePerOccurrenceCents?: number | undefined;
  onContinue: () => void;
}

type MonthDay = AvailabilityMonth['days'][number];

/** Start dates are any day from today to the advance limit: occurrences are checked afterwards. */
function startDateDays(month: string, today: LocalDate): MonthDay[] {
  const limit = addDays(today, MAX_ADVANCE_DAYS);
  return datesOfMonth(month).map((date) => ({
    date,
    status: date < today ? 'past' : date > limit ? 'out_of_range' : 'available',
    isHoliday: false,
    holidayName: null,
    hasDiscount: false,
  }));
}

/**
 * Room + start date + the occurrences they produce (REC-84, REC-91). The choices live in the URL
 * (`roomId`, `baseOn`), so a conflict suggestion is a link-sized change and survives login.
 */
export function FixedSchedulePicker({
  categoryId,
  pricePerOccurrenceCents,
  onContinue,
}: FixedSchedulePickerProps) {
  const [params, setParams] = useSearchParams();
  const roomId = params.get(PICKER_PARAMS.room);
  const baseOn = params.get(PICKER_PARAMS.baseOn);
  const today = utcToLocal(new Date()).date;

  const [month, setMonth] = useState(monthOf(baseOn ?? today));
  const rooms = useRooms();
  const check = useOccurrenceCheck(categoryId, {
    ...(roomId ? { roomId } : {}),
    ...(baseOn ? { baseOn } : {}),
  });

  const choose = (patch: { roomId?: string; baseOn?: string }) => {
    const next = new URLSearchParams(params);
    if (patch.roomId) next.set(PICKER_PARAMS.room, patch.roomId);
    if (patch.baseOn) next.set(PICKER_PARAMS.baseOn, patch.baseOn);
    setParams(next, { replace: true });
    if (patch.baseOn) setMonth(monthOf(patch.baseOn));
  };

  const result = roomId && baseOn ? check.data : undefined;
  const hasConflicts = (result?.conflicts.length ?? 0) > 0;
  const count = result?.occurrences.length ?? 0;
  const perOccurrence =
    pricePerOccurrenceCents ?? (count > 0 && result ? result.periodPriceCents / count : 0);
  const canContinue = Boolean(result) && !check.isFetching && !hasConflicts && count > 0;

  return (
    <div className="space-y-space-xl">
      <fieldset className="space-y-space-sm">
        <legend className="font-heading-mobile text-heading-mobile text-ink">Sala</legend>
        {rooms.isPending ? (
          <Spinner label="Carregando salas" />
        ) : rooms.isError ? (
          <Alert tone="error">Não foi possível carregar as salas agora.</Alert>
        ) : (
          <div className="grid gap-space-sm sm:grid-cols-3">
            {rooms.data.items.map((room) => {
              const checked = roomId === room.id;
              return (
                <label
                  key={room.id}
                  className={cx(
                    'flex cursor-pointer items-center gap-space-sm rounded-card border p-space-md font-small text-small transition-colors focus-within:ring-2 focus-within:ring-bronze',
                    checked
                      ? 'border-bronze bg-champagne-soft text-on-champagne'
                      : 'border-hairline bg-surface-raised text-ink hover:border-bronze',
                  )}
                >
                  <input
                    type="radio"
                    name="fixed-room"
                    value={room.id}
                    checked={checked}
                    onChange={() => {
                      choose({ roomId: room.id });
                    }}
                    className={cx('h-4 w-4 accent-bronze', focusRing)}
                  />
                  <span className="font-medium">{room.name}</span>
                </label>
              );
            })}
          </div>
        )}
      </fieldset>

      <section aria-labelledby="fixed-start" className="space-y-space-sm">
        <h2 id="fixed-start" className="font-heading-mobile text-heading-mobile text-ink">
          Início do período
        </h2>
        <MonthCalendar
          month={month}
          days={startDateDays(month, today)}
          value={baseOn}
          minMonth={monthOf(today)}
          onSelect={(date) => {
            choose({ baseOn: date });
          }}
          onMonthChange={setMonth}
        />
      </section>

      {roomId && baseOn ? (
        <section aria-labelledby="fixed-result" className="space-y-space-md" aria-live="polite">
          <h2 id="fixed-result" className="font-heading-mobile text-heading-mobile text-ink">
            Seus horários
          </h2>
          {check.isPending || check.isPlaceholderData ? (
            <Spinner label="Verificando os horários" />
          ) : check.isError ? (
            <Alert tone="error">
              {messageOf(check.error, 'Não foi possível verificar os horários agora.')}
            </Alert>
          ) : result ? (
            <>
              {hasConflicts ? (
                <Alert tone="error">
                  <p className="font-medium">
                    Alguns horários não estão disponíveis nesta sala e data de início:
                  </p>
                  <ul className="mt-space-xs list-disc space-y-1 pl-space-md">
                    {result.conflicts.map((conflict) => (
                      <li key={conflict.date}>
                        {formatWeekdayDate(conflict.date)}: {conflict.label}
                      </li>
                    ))}
                  </ul>
                </Alert>
              ) : null}
              {hasConflicts &&
              (result.suggestions.rooms.length > 0 || result.suggestions.baseDates.length > 0) ? (
                <div className="space-y-space-xs">
                  <p className="font-small text-small text-ink-muted">Que tal tentar:</p>
                  <div className="flex flex-wrap gap-space-sm">
                    {result.suggestions.rooms.map((room) => (
                      <Button
                        key={room.roomId}
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          choose({ roomId: room.roomId });
                        }}
                      >
                        {room.roomName}
                      </Button>
                    ))}
                    {result.suggestions.baseDates.map((date) => (
                      <Button
                        key={date}
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          choose({ baseOn: date });
                        }}
                      >
                        {`Iniciar em ${formatLocalDateBR(date)}`}
                      </Button>
                    ))}
                  </div>
                </div>
              ) : null}
              {!hasConflicts && count > 0 ? (
                <div className="space-y-space-sm">
                  <p className="font-small text-small text-ink">
                    {`Período de ${formatLocalDateBR(result.startsOn)} a ${formatLocalDateBR(addDays(result.endsOn, -1))}`}
                  </p>
                  <p className="font-body text-body font-semibold text-ink">
                    {formatPeriodPrice(count, perOccurrence)}
                  </p>
                  <details className="font-small text-small text-ink-muted">
                    <summary className={cx('cursor-pointer', focusRing)}>
                      {`Ver as ${String(count)} datas`}
                    </summary>
                    <ul className="mt-space-xs space-y-1">
                      {result.occurrences.map((occurrence) => (
                        <li key={occurrence.date}>{formatOccurrence(occurrence)}</li>
                      ))}
                    </ul>
                  </details>
                </div>
              ) : null}
              {!hasConflicts && count === 0 ? (
                <Alert>Nenhum horário cai neste período. Escolha outra data de início.</Alert>
              ) : null}
            </>
          ) : null}
        </section>
      ) : (
        <p className="font-small text-small text-ink-muted">
          Escolha a sala e a data de início para ver os seus horários.
        </p>
      )}

      <Button disabled={!canContinue} onClick={onContinue}>
        Continuar
      </Button>
    </div>
  );
}
