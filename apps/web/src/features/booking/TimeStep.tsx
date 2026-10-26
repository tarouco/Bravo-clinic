import { useEffect, useRef } from 'react';
import { SlotGrid, type BlockOption, type SlotSelection } from '../../components/calendar/SlotGrid';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Alert, Spinner } from '../../components/ui/Feedback';
import { formatDuration, formatLocalDateBR, formatMinuteRange } from '../../lib/format';
import { track } from '../../lib/analytics';
import { useDayAvailability } from '../availability/api';
import { isComplete, type FlowSelection } from './flow-params';

export interface TimeStepProps {
  selection: FlowSelection;
  onChange: (next: FlowSelection) => void;
  onBack: () => void;
  onContinue: () => void;
}

/** Step 2, "Horário": a start cell and duration, or a closed block option. */
export function TimeStep({ selection, onChange, onBack, onContinue }: TimeStepProps) {
  const { sala, data } = selection;
  const dayQuery = useDayAvailability(sala ?? undefined, data ?? undefined);
  const day = dayQuery.data;

  // `select_slot` fires once per distinct choice, not on every re-render.
  const tracked = useRef<string | null>(null);
  const choiceKey = selection.bloco ?? `${String(selection.inicio)}-${String(selection.fim)}`;
  useEffect(() => {
    if (!isComplete(selection) || tracked.current === choiceKey) return;
    tracked.current = choiceKey;
    track('select_slot', {
      room: selection.sala,
      date: selection.data,
      start_minute: selection.inicio,
      end_minute: selection.fim,
      block: selection.bloco,
    });
  }, [selection, choiceKey]);

  const value: SlotSelection = { startMinute: selection.inicio, endMinute: selection.fim };
  const block = day?.blockOptions.find((option) => option.categoryId === selection.bloco);

  const onSlotChange = (next: SlotSelection) => {
    onChange({ ...selection, bloco: null, inicio: next.startMinute, fim: next.endMinute });
  };
  const onSelectBlock = (option: BlockOption) => {
    onChange({ ...selection, bloco: option.categoryId, inicio: null, fim: null });
  };

  return (
    <div className="space-y-space-lg">
      <div className="space-y-space-xs">
        <h2 className="font-heading-mobile text-heading-mobile text-ink">
          Horários de {data ? formatLocalDateBR(data) : ''}
        </h2>
        {day?.isHoliday ? <Badge>Feriado: {day.holidayName}</Badge> : null}
      </div>

      {dayQuery.isPending ? (
        <Spinner label="Carregando horários" />
      ) : dayQuery.isError || !day ? (
        <Alert tone="error">Não foi possível carregar os horários deste dia.</Alert>
      ) : day.closed ? (
        <Alert>A clínica está fechada neste dia. Escolha outra data.</Alert>
      ) : day.outOfRange ? (
        <Alert>Esta data está fora do período de reservas. Escolha outra data.</Alert>
      ) : (
        <SlotGrid
          cells={day.cells}
          slotMinutes={day.slotMinutes}
          minBookingMinutes={day.minBookingMinutes}
          value={value}
          onChange={onSlotChange}
          blockOptions={day.blockOptions}
          selectedBlockId={selection.bloco}
          onSelectBlock={onSelectBlock}
        />
      )}

      <p aria-live="polite" className="min-h-6 font-small text-small text-ink-muted">
        {block
          ? `${block.name} · ${formatMinuteRange(block.startMinute, block.endMinute)}`
          : selection.inicio !== null && selection.fim !== null
            ? `${formatMinuteRange(selection.inicio, selection.fim)} (${formatDuration(selection.fim - selection.inicio)})`
            : ''}
      </p>

      <div className="flex flex-wrap gap-space-sm">
        <Button variant="secondary" onClick={onBack}>
          Voltar
        </Button>
        <Button disabled={!isComplete(selection)} onClick={onContinue}>
          Continuar
        </Button>
      </div>
    </div>
  );
}
