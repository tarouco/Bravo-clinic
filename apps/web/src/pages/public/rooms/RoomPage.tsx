import { CircleCheck } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { formatBRL, utcToLocal } from '@bravo/core';
import { PriceTag } from '../../../components/booking/PriceTag';
import { MonthCalendar } from '../../../components/calendar/MonthCalendar';
import { SlotGrid, type SlotSelection } from '../../../components/calendar/SlotGrid';
import { Badge } from '../../../components/ui/Badge';
import { Eyebrow } from '../../../components/ui/Brand';
import { Button } from '../../../components/ui/Button';
import { Alert, Spinner } from '../../../components/ui/Feedback';
import { Icon } from '../../../components/ui/Icon';
import { ROOM_PLACEHOLDER_SRC } from '../../../components/ui/RoomCard';
import { useDayAvailability, useMonthAvailability } from '../../../features/availability/api';
import { useCatalog, useRoom } from '../../../features/catalog/api';
import { ApiError } from '../../../lib/api';
import { monthOf } from '../../../lib/calendar-dates';
import { photoSrcSet, smallPhotoUrl } from '../../../lib/room-photo';
import { useHydrated } from '../../../lib/useHydrated';
import { formatDuration, formatLocalDateBR, formatMinuteRange } from '../../../lib/format';
import { usePageTitle } from '../../../lib/usePageTitle';
import { NotFoundPage } from '../NotFoundPage';

const EMPTY: SlotSelection = { startMinute: null, endMinute: null };

function Gallery({
  photos,
  roomName,
}: {
  photos: { url: string; alt: string }[];
  roomName: string;
}) {
  const [active, setActive] = useState(0);
  const photo = photos[active];
  const src = photo?.url ?? ROOM_PLACEHOLDER_SRC;
  return (
    <div className="space-y-space-sm">
      <img
        className="h-72 w-full rounded-card object-cover md:h-96"
        src={src}
        srcSet={photoSrcSet(src)}
        sizes="(min-width: 1024px) 60vw, 100vw"
        alt={photo?.alt || `Foto da ${roomName}`}
        fetchPriority="high"
      />
      {photos.length > 1 ? (
        <ul className="flex gap-space-xs" aria-label="Fotos da sala">
          {photos.map((item, index) => (
            <li key={item.url}>
              <button
                type="button"
                aria-label={`Foto ${String(index + 1)}`}
                aria-current={index === active}
                onClick={() => {
                  setActive(index);
                }}
                className="overflow-hidden rounded-control border border-hairline aria-[current=true]:border-bronze"
              >
                <img
                  className="h-16 w-24 object-cover"
                  src={smallPhotoUrl(item.url) ?? item.url}
                  alt=""
                  loading="lazy"
                />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Categories() {
  const { data } = useCatalog();
  if (!data) return null;
  return (
    <section aria-labelledby="room-categories" className="space-y-space-sm">
      <h2 id="room-categories" className="font-heading-mobile text-heading-mobile text-ink">
        Categorias e valores
      </h2>
      <ul className="divide-y divide-hairline rounded-card border border-hairline bg-surface-raised">
        {data.hourly.map((category) => (
          <li key={category.id} className="space-y-1 p-space-md font-small text-small">
            <p className="font-medium text-ink">{category.name}</p>
            <p className="text-ink-muted">
              Dias úteis <PriceTag cents={category.weekdayRateCents} unit="/h" /> · Fins de semana e
              feriados <PriceTag cents={category.weekendRateCents} unit="/h" />
            </p>
          </li>
        ))}
        {data.blocks.map((block) => (
          <li key={block.id} className="space-y-1 p-space-md font-small text-small">
            <p className="font-medium text-ink">{block.name}</p>
            <p className="text-ink-muted">
              {formatBRL(block.fixedPriceCents)} · valor médio{' '}
              <PriceTag cents={block.averageHourlyCents} unit="/h" />
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Availability({ slug }: { slug: string }) {
  const today = utcToLocal(new Date()).date;
  const [month, setMonth] = useState(monthOf(today));
  const [date, setDate] = useState<string | null>(null);
  const [selection, setSelection] = useState<SlotSelection>(EMPTY);
  const [blockId, setBlockId] = useState<string | null>(null);

  const monthQuery = useMonthAvailability(slug, month);
  const dayQuery = useDayAvailability(slug, date ?? undefined);
  const day = dayQuery.data;

  const complete = selection.startMinute !== null && selection.endMinute !== null;
  const bookingPath = (() => {
    if (!date) return null;
    const base = `/reservar?sala=${encodeURIComponent(slug)}&data=${date}`;
    if (blockId) return `${base}&bloco=${encodeURIComponent(blockId)}`;
    if (complete)
      return `${base}&inicio=${String(selection.startMinute)}&fim=${String(selection.endMinute)}`;
    return null;
  })();
  const block = day?.blockOptions.find((option) => option.categoryId === blockId);

  return (
    <section aria-labelledby="room-availability" className="space-y-space-md">
      <h2 id="room-availability" className="font-heading-mobile text-heading-mobile text-ink">
        Disponibilidade
      </h2>
      <MonthCalendar
        month={month}
        days={monthQuery.data?.days ?? []}
        value={date}
        minMonth={monthOf(today)}
        onSelect={(next) => {
          setDate(next);
          setSelection(EMPTY);
          setBlockId(null);
        }}
        onMonthChange={setMonth}
      />

      {date ? (
        <div className="space-y-space-sm">
          <h3 className="font-heading-mobile text-body text-ink">
            Horários de {formatLocalDateBR(date)}
          </h3>
          {dayQuery.isPending ? (
            <Spinner label="Carregando horários" />
          ) : dayQuery.isError || !day ? (
            <Alert tone="error">Não foi possível carregar os horários deste dia.</Alert>
          ) : day.closed ? (
            <Alert>A clínica está fechada neste dia.</Alert>
          ) : day.outOfRange ? (
            <Alert>Esta data está fora do período de reservas.</Alert>
          ) : (
            <>
              {day.isHoliday ? <Badge>Feriado: {day.holidayName}</Badge> : null}
              <SlotGrid
                cells={day.cells}
                slotMinutes={day.slotMinutes}
                minBookingMinutes={day.minBookingMinutes}
                value={selection}
                onChange={(next) => {
                  setSelection(next);
                  setBlockId(null);
                }}
                blockOptions={day.blockOptions}
                selectedBlockId={blockId}
                onSelectBlock={(option) => {
                  setBlockId(option.categoryId);
                  setSelection(EMPTY);
                }}
              />
            </>
          )}
          {bookingPath ? (
            <div className="space-y-space-xs">
              <p className="font-small text-small text-ink-muted">
                {block
                  ? `${block.name} · ${formatMinuteRange(block.startMinute, block.endMinute)}`
                  : selection.startMinute !== null && selection.endMinute !== null
                    ? `${formatMinuteRange(selection.startMinute, selection.endMinute)} (${formatDuration(selection.endMinute - selection.startMinute)})`
                    : ''}
              </p>
              <Button asChild>
                <Link to={bookingPath}>Reservar este horário</Link>
              </Button>
            </div>
          ) : (
            <Button disabled>Reservar este horário</Button>
          )}
        </div>
      ) : null}
    </section>
  );
}

/** `/salas/:slug`: gallery, description, equipment, categories and the availability calendar. */
export function RoomPage() {
  const { slug } = useParams();
  const { data: room, isPending, error } = useRoom(slug);
  const hydrated = useHydrated();
  usePageTitle(room?.name ?? 'Sala');

  if (isPending) {
    return (
      <div className="flex justify-center py-space-hero">
        <Spinner label="Carregando sala" />
      </div>
    );
  }
  if (error instanceof ApiError && error.status === 404) return <NotFoundPage />;
  if (!room) {
    return (
      <div className="mx-auto max-w-3xl px-gutter py-space-3xl">
        <Alert tone="error">Não foi possível carregar a sala agora.</Alert>
      </div>
    );
  }

  const photos = room.photos.length > 0 ? room.photos : room.cover ? [room.cover] : [];

  return (
    <div className="mx-auto max-w-7xl space-y-space-2xl px-gutter py-space-3xl">
      <header className="space-y-space-xs">
        <Eyebrow>SALAS INTELIGENTES</Eyebrow>
        <h1 className="font-display-l-mobile text-display-l-mobile text-ink md:font-display-l md:text-display-l">
          {room.name}
        </h1>
        <div className="flex flex-wrap gap-1.5">
          {room.idealFor.map((tag) => (
            <Badge key={tag}>{tag}</Badge>
          ))}
        </div>
      </header>

      <div className="grid gap-space-2xl lg:grid-cols-[3fr_2fr]">
        <div className="space-y-space-xl">
          <Gallery photos={photos} roomName={room.name} />
          <p className="font-body text-body text-ink-muted">{room.description}</p>
          <section aria-labelledby="room-equipment" className="space-y-space-sm">
            <h2 id="room-equipment" className="font-heading-mobile text-heading-mobile text-ink">
              Equipamentos
            </h2>
            <ul className="space-y-space-xs font-small text-small text-ink-muted">
              {room.equipment.map((item) => (
                <li key={item} className="flex items-center gap-space-xs">
                  <Icon as={CircleCheck} size={16} className="shrink-0 text-bronze" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>
          <Categories />
        </div>
        {/* The calendar depends on today: prerendered markup (GES-143) leaves it to the browser. */}
        {hydrated ? (
          <Availability slug={room.slug} />
        ) : (
          <section aria-labelledby="room-availability" className="min-h-96 space-y-space-md">
            <h2 id="room-availability" className="font-heading-mobile text-heading-mobile text-ink">
              Disponibilidade
            </h2>
          </section>
        )}
      </div>
    </div>
  );
}
