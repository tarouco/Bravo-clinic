import { utcToLocal, type LocalDate } from '@bravo/core';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DayView } from '../../components/calendar/DayView';
import { MonthCalendarView } from '../../components/calendar/MonthCalendarView';
import { toneOfStatus, type ScheduleEvent } from '../../components/calendar/schedule';
import { WeekCalendar } from '../../components/calendar/WeekCalendar';
import { Alert, Spinner } from '../../components/ui/Feedback';
import { Tabs } from '../../components/ui/Tabs';
import { useMyBookings } from '../../features/booking/api';
import { CalendarSyncCard } from '../../features/calendar-sync/CalendarSyncCard';
import { usePageTitle } from '../../lib/usePageTitle';

type View = 'month' | 'week' | 'day';

const VIEWS: { id: View; label: string }[] = [
  { id: 'month', label: 'Mês' },
  { id: 'week', label: 'Semana' },
  { id: 'day', label: 'Dia' },
];

/** `/app/agenda`: the tenant's bookings by month, week or day, without cleanup (NUC-190). */
export function AgendaPage() {
  usePageTitle('Agenda');
  const navigate = useNavigate();
  const today = utcToLocal(new Date()).date;
  const [view, setView] = useState<View>('month');
  const [date, setDate] = useState<LocalDate>(today);

  // The agenda needs every upcoming booking, so it pages through the whole tab; the past tab
  // contributes its newest page.
  const upcoming = useMyBookings('upcoming');
  const past = useMyBookings('past');
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = upcoming;
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const events = useMemo<ScheduleEvent[]>(() => {
    const bookings = [
      ...(upcoming.data?.pages.flatMap((page) => page.items) ?? []),
      ...(past.data?.pages.flatMap((page) => page.items) ?? []),
    ];
    return bookings.map((booking) => ({
      id: booking.id,
      kind: 'booking',
      startsAt: booking.startsAt,
      endsAt: booking.endsAt,
      title: booking.roomName,
      tone: toneOfStatus(booking.status),
      onClick: () => {
        void navigate(`/app/minhas-reservas/${booking.id}`);
      },
    }));
  }, [upcoming.data, past.data, navigate]);

  const shared = { today, events, showCleanup: false } as const;

  const body = (id: View) => {
    if (id !== view) return null;
    if (id === 'month') {
      return (
        <MonthCalendarView
          date={date}
          today={today}
          events={events}
          onNavigate={(next) => {
            setDate(next.date);
          }}
          onSelectDate={(selected) => {
            setDate(selected);
            setView('day');
          }}
        />
      );
    }
    if (id === 'week') {
      return (
        <WeekCalendar
          {...shared}
          date={date}
          onNavigate={(next) => {
            setDate(next.date);
          }}
        />
      );
    }
    return (
      <DayView
        {...shared}
        date={date}
        onNavigate={(next) => {
          setDate(next.date);
        }}
      />
    );
  };

  return (
    <div className="mx-auto max-w-5xl space-y-space-lg">
      <h1 className="font-heading text-heading-mobile text-ink md:text-heading">Agenda</h1>
      {upcoming.isError ? (
        <Alert tone="error">Não foi possível carregar suas reservas agora.</Alert>
      ) : null}
      {upcoming.isPending ? <Spinner label="Carregando agenda" /> : null}
      <Tabs
        label="Visualização"
        value={view}
        onValueChange={(id) => {
          setView(id as View);
        }}
        items={VIEWS.map(({ id, label }) => ({ id, label, content: body(id) }))}
      />
      <CalendarSyncCard />
    </div>
  );
}
