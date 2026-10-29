import { utcToLocal } from '@bravo/core';
import { useState } from 'react';
import { DayStrip } from '../../components/booking/DayStrip';
import { Button } from '../../components/ui/Button';
import { cx, focusRing } from '../../components/ui/cx';
import { Alert, Spinner } from '../../components/ui/Feedback';
import { monthOf } from '../../lib/calendar-dates';
import { useMonthAvailability } from '../availability/api';
import { useRooms } from '../catalog/api';
import type { FlowSelection } from './flow-params';

export interface DateStepProps {
  selection: FlowSelection;
  onChange: (next: FlowSelection) => void;
  onContinue: () => void;
}

/** Step 1, "Sala e data": choose the room, then a day of its month calendar. */
export function DateStep({ selection, onChange, onContinue }: DateStepProps) {
  const today = utcToLocal(new Date()).date;
  const rooms = useRooms();
  const [month, setMonth] = useState(monthOf(selection.data ?? today));
  const monthQuery = useMonthAvailability(selection.sala ?? undefined, month);

  const chooseRoom = (slug: string) => {
    if (slug === selection.sala) return;
    // Another room has other bookings, so the time chosen so far no longer applies.
    onChange({ ...selection, sala: slug, inicio: null, fim: null, bloco: null });
  };

  const chooseDate = (date: string) => {
    if (date === selection.data) return;
    onChange({ ...selection, data: date, inicio: null, fim: null, bloco: null });
  };

  return (
    <div className="space-y-space-lg">
      <fieldset className="space-y-space-sm">
        <legend className="font-heading-mobile text-heading-mobile text-ink">Sala</legend>
        {rooms.isPending ? (
          <Spinner label="Carregando salas" />
        ) : rooms.isError ? (
          <Alert tone="error">Não foi possível carregar as salas agora.</Alert>
        ) : (
          <div className="grid gap-space-sm sm:grid-cols-3">
            {rooms.data.items.map((room) => {
              const checked = selection.sala === room.slug;
              return (
                <label
                  key={room.id}
                  className={cx(
                    'flex cursor-pointer flex-col gap-1 rounded-md p-space-md font-small text-small shadow-card transition-colors focus-within:ring-2 focus-within:ring-accent focus-within:ring-offset-2 focus-within:ring-offset-surface',
                    checked
                      ? 'bg-grad-emerald text-on-emerald shadow-relief-emerald'
                      : 'bg-surface-raised text-ink hover:bg-surface-panel',
                  )}
                >
                  <span className="flex items-center gap-space-sm">
                    <input
                      type="radio"
                      name="sala"
                      value={room.slug}
                      checked={checked}
                      onChange={() => {
                        chooseRoom(room.slug);
                      }}
                      className={cx('h-4 w-4 accent-emerald', focusRing)}
                    />
                    <span className="font-medium">{room.name}</span>
                  </span>
                  <span className={checked ? 'text-on-emerald/85' : 'text-ink-muted'}>
                    {room.idealFor.join(' · ')}
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </fieldset>

      <section aria-labelledby="flow-date" className="space-y-space-sm">
        <h2 id="flow-date" className="font-heading-mobile text-heading-mobile text-ink">
          Data
        </h2>
        {selection.sala ? (
          <DayStrip
            month={month}
            days={monthQuery.data?.days ?? []}
            value={selection.data}
            minMonth={monthOf(today)}
            hideBefore={today}
            onSelect={chooseDate}
            onMonthChange={setMonth}
          />
        ) : (
          <p className="font-small text-small text-ink-muted">
            Escolha uma sala para ver as datas disponíveis.
          </p>
        )}
      </section>

      <Button block disabled={!selection.sala || !selection.data} onClick={onContinue}>
        Continuar
      </Button>
    </div>
  );
}
