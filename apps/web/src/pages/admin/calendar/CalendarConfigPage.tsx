import { utcToLocal, type LocalDate } from '@bravo/core';
import { useEffect, useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { Alert, Spinner } from '../../../components/ui/Feedback';
import { Tabs } from '../../../components/ui/Tabs';
import { useToast } from '../../../components/ui/Toast';
import { AffectedBookingsModal } from '../../../features/admin-calendar/AffectedBookingsModal';
import { CalendarSettingsPanel } from '../../../features/admin-calendar/CalendarSettingsPanel';
import {
  CategoryBandOverlay,
  CategoryOverlayPicker,
} from '../../../features/admin-calendar/CategoryBandOverlay';
import { CategoriesTable } from '../../../features/admin-calendar/CategoriesTable';
import { ExceptionsMonth } from '../../../features/admin-calendar/ExceptionsMonth';
import { HolidayReviewBanner } from '../../../features/admin-calendar/HolidayReviewBanner';
import { toHourlyCategories } from '../../../features/admin-calendar/category-utils';
import { OnboardingChecklist } from '../../../features/admin-calendar/OnboardingChecklist';
import {
  DAY_ORDER,
  WeekHoursEditor,
  type HoursRow,
} from '../../../features/admin-calendar/WeekHoursEditor';
import { useCalendarConfig, useUpdateBusinessHours } from '../../../features/calendar/api';
import { useCategories } from '../../../features/categories/api';
import { ApiError } from '../../../lib/api';
import { affectedBookingsOf, messageOf } from '../../../lib/api-errors';
import { usePageTitle } from '../../../lib/usePageTitle';

/** `/admin/calendario`: opening hours, calendar parameters, prices and exceptions (PRD 7.3.1). */
export function CalendarConfigPage() {
  usePageTitle('Calendário');
  const config = useCalendarConfig();
  const data = config.data;
  const today = utcToLocal(new Date()).date;
  const [tab, setTab] = useState('funcionamento');
  // A tab mounts when first opened and then stays mounted, so unsaved edits survive tab changes.
  const [visited, setVisited] = useState<ReadonlySet<string>>(new Set(['funcionamento']));
  const open = (id: string) => {
    setVisited((current) => new Set(current).add(id));
    setTab(id);
  };
  const [exceptionsDate, setExceptionsDate] = useState<LocalDate>(today);

  return (
    <div className="mx-auto max-w-7xl space-y-space-lg">
      <h1 className="font-display-l-mobile text-display-l-mobile text-ink lg:font-display-l lg:text-display-l">
        Calendário
      </h1>
      {config.isPending ? <Spinner label="Carregando calendário" /> : null}
      {config.isError ? (
        <Alert tone="error">
          {messageOf(config.error, 'Não foi possível carregar o calendário agora.')}
        </Alert>
      ) : null}
      {data ? (
        <>
          {data.onboarding.pricesReviewed ? null : <OnboardingChecklist />}
          <HolidayReviewBanner
            today={today}
            onViewList={(year) => {
              setExceptionsDate(`${String(year)}-01-01` as LocalDate);
              open('excecoes');
            }}
          />
          <Tabs
            label="Seções do calendário"
            value={tab}
            onValueChange={open}
            items={[
              {
                id: 'funcionamento',
                label: 'Funcionamento',
                content: (
                  <div className="space-y-space-xl">
                    <HoursSection
                      businessHours={data.businessHours}
                      slotMinutes={data.settings.slotMinutes}
                      defaultBookingMinutes={data.settings.defaultBookingMinutes}
                    />
                    <CalendarSettingsPanel settings={data.settings} warnings={data.warnings} />
                  </div>
                ),
              },
              {
                id: 'valores',
                label: 'Valores',
                content: visited.has('valores') ? <CategoriesTable /> : null,
              },
              {
                id: 'excecoes',
                label: 'Exceções e bloqueios',
                content: visited.has('excecoes') ? (
                  <ExceptionsMonth
                    date={exceptionsDate}
                    today={today}
                    onDateChange={setExceptionsDate}
                  />
                ) : null,
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
  defaultBookingMinutes,
}: {
  businessHours: HoursRow[];
  slotMinutes: number;
  defaultBookingMinutes: number;
}) {
  const save = useUpdateBusinessHours();
  const { toast } = useToast();
  const categories = useCategories();
  const hourly = toHourlyCategories(categories.data?.items ?? []);
  const [selected, setSelected] = useState<Set<string>>(new Set());
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
      <CategoryOverlayPicker categories={hourly} selectedIds={selected} onChange={setSelected} />
      <WeekHoursEditor
        rows={rows}
        slotMinutes={slotMinutes}
        onChange={setRows}
        renderOverlay={({ row, pxPerMinute }) => (
          <CategoryBandOverlay
            categories={hourly}
            selectedIds={selected}
            weekday={Math.max(1, DAY_ORDER.indexOf(row.dayType) + 1)}
            isHoliday={row.dayType === 'holiday'}
            window={{ openMinute: row.openMinute, closeMinute: row.closeMinute }}
            durationMinutes={defaultBookingMinutes}
            pxPerMinute={pxPerMinute}
          />
        )}
      />
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
