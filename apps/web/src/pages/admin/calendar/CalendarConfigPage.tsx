import { useEffect, useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { Alert, Spinner } from '../../../components/ui/Feedback';
import { Tabs } from '../../../components/ui/Tabs';
import { useToast } from '../../../components/ui/Toast';
import { AffectedBookingsModal } from '../../../features/admin-calendar/AffectedBookingsModal';
import { CalendarSettingsPanel } from '../../../features/admin-calendar/CalendarSettingsPanel';
import { OnboardingChecklist } from '../../../features/admin-calendar/OnboardingChecklist';
import { WeekHoursEditor, type HoursRow } from '../../../features/admin-calendar/WeekHoursEditor';
import { useCalendarConfig, useUpdateBusinessHours } from '../../../features/calendar/api';
import { ApiError } from '../../../lib/api';
import { affectedBookingsOf, messageOf } from '../../../lib/api-errors';
import { usePageTitle } from '../../../lib/usePageTitle';

/** `/admin/calendario`: opening hours, calendar parameters, prices and exceptions (PRD 7.3.1). */
export function CalendarConfigPage() {
  usePageTitle('Calendário');
  const config = useCalendarConfig();
  const data = config.data;

  return (
    <div className="mx-auto max-w-7xl space-y-space-lg">
      <h1 className="font-heading text-heading-mobile text-ink md:text-heading">Calendário</h1>
      {config.isPending ? <Spinner label="Carregando calendário" /> : null}
      {config.isError ? (
        <Alert tone="error">
          {messageOf(config.error, 'Não foi possível carregar o calendário agora.')}
        </Alert>
      ) : null}
      {data ? (
        <>
          {data.onboarding.pricesReviewed ? null : <OnboardingChecklist />}
          <Tabs
            label="Seções do calendário"
            items={[
              {
                id: 'funcionamento',
                label: 'Funcionamento',
                content: (
                  <div className="space-y-space-xl">
                    <HoursSection
                      businessHours={data.businessHours}
                      slotMinutes={data.settings.slotMinutes}
                    />
                    <CalendarSettingsPanel settings={data.settings} warnings={data.warnings} />
                  </div>
                ),
              },
            ]}
          />
        </>
      ) : null}
    </div>
  );
}

function HoursSection({
  businessHours,
  slotMinutes,
}: {
  businessHours: HoursRow[];
  slotMinutes: number;
}) {
  const save = useUpdateBusinessHours();
  const { toast } = useToast();
  const [rows, setRows] = useState<HoursRow[]>(businessHours);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{
    message: string;
    bookings: NonNullable<ReturnType<typeof affectedBookingsOf>>;
  } | null>(null);

  useEffect(() => {
    setRows(businessHours);
  }, [businessHours]);

  const dirty = JSON.stringify(rows) !== JSON.stringify(businessHours);

  const submit = () => {
    setError(null);
    save.mutate(
      { rows },
      {
        onSuccess: () => {
          toast({ message: 'Horário de funcionamento salvo.' });
        },
        onError: (caught) => {
          const bookings = affectedBookingsOf(caught);
          if (bookings) {
            setConflict({ message: caught instanceof ApiError ? caught.message : '', bookings });
            return;
          }
          setError(messageOf(caught, 'Não foi possível salvar. Tente novamente.'));
        },
      },
    );
  };

  return (
    <section aria-labelledby="hours-title" className="space-y-space-md">
      <h2 id="hours-title" className="font-heading text-heading-mobile text-ink">
        Horário de funcionamento
      </h2>
      <p className="font-small text-small text-ink-muted">
        Digite os horários ou arraste o início e o fim de cada dia. Os valores seguem o slot de{' '}
        {slotMinutes} min.
      </p>
      <WeekHoursEditor rows={rows} slotMinutes={slotMinutes} onChange={setRows} />
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div className="flex flex-wrap gap-space-sm">
        <Button loading={save.isPending} disabled={!dirty} onClick={submit}>
          Salvar horários
        </Button>
        <Button
          variant="secondary"
          disabled={!dirty}
          onClick={() => {
            setRows(businessHours);
          }}
        >
          Descartar alterações
        </Button>
      </div>
      <AffectedBookingsModal
        open={conflict !== null}
        onClose={() => {
          setConflict(null);
        }}
        title="Reservas afetadas"
        message={
          conflict?.message ||
          'Existem reservas fora do novo horário. Realoque ou cancele antes de continuar.'
        }
        bookings={conflict?.bookings ?? []}
      />
    </section>
  );
}
