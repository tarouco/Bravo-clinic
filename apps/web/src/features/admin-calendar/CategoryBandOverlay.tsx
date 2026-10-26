import { coverageBands, formatBRL, type HourlyCategory } from '@bravo/core';
import { Checkbox } from '../../components/ui/form';
import { formatHHMM } from './time';

export interface CategoryBandOverlayProps {
  /** Every hourly category; uncovered ranges are computed over all the active ones. */
  categories: readonly HourlyCategory[];
  /** Categories drawn as bands; nothing is drawn while empty. */
  selectedIds: ReadonlySet<string>;
  /** ISO weekday of the column; a holiday column uses `isHoliday`. */
  weekday: number;
  isHoliday: boolean;
  /** Business window of the day. */
  window: { openMinute: number; closeMinute: number };
  /** Booking length used to pick the category (the default booking duration). */
  durationMinutes: number;
  pxPerMinute: number;
}

const BAND_TONES = [
  'border-bronze bg-bronze/20',
  'border-champagne bg-champagne/40',
  'border-walnut bg-walnut/20',
  'border-secondary bg-secondary-container/60',
] as const;

interface Placed {
  categoryId: string;
  name: string;
  startMinute: number;
  endMinute: number;
  rateCents: number;
  tone: string;
  lane: number;
  lanes: number;
}

/** Side-by-side lanes for bands that overlap in time. */
function placeBands(
  bands: {
    categoryId: string;
    name: string;
    startMinute: number;
    endMinute: number;
    rateCents: number;
  }[],
  toneOf: (categoryId: string) => string,
): Placed[] {
  const sorted = [...bands].sort(
    (a, b) => a.startMinute - b.startMinute || b.endMinute - a.endMinute,
  );
  const placed: Placed[] = [];
  let cluster: Placed[] = [];
  let clusterEnd = -1;
  const laneEnds: number[] = [];
  const close = () => {
    for (const p of cluster) p.lanes = Math.max(1, laneEnds.length);
    cluster = [];
    laneEnds.length = 0;
  };
  for (const band of sorted) {
    if (band.startMinute >= clusterEnd) {
      close();
      clusterEnd = -1;
    }
    let lane = laneEnds.findIndex((end) => end <= band.startMinute);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = band.endMinute;
    const item: Placed = { ...band, tone: toneOf(band.categoryId), lane, lanes: 1 };
    cluster.push(item);
    placed.push(item);
    clusterEnd = Math.max(clusterEnd, band.endMinute);
  }
  close();
  return placed;
}

/**
 * Price bands of the selected categories over one day column, and the ranges no category covers
 * hatched as "Horário sem categoria" (NUC-72). Rendered inside the column's positioned box.
 */
export function CategoryBandOverlay({
  categories,
  selectedIds,
  weekday,
  isHoliday,
  window,
  durationMinutes,
  pxPerMinute,
}: CategoryBandOverlayProps) {
  if (selectedIds.size === 0) return null;
  const { bands, uncovered } = coverageBands(
    [...categories],
    { weekday, isHoliday },
    window,
    durationMinutes,
  );
  const order = categories.map((c) => c.id);
  const placed = placeBands(
    bands.filter((b) => selectedIds.has(b.categoryId)),
    (id) => BAND_TONES[order.indexOf(id) % BAND_TONES.length] ?? BAND_TONES[0],
  );

  return (
    <div className="pointer-events-none absolute inset-0 z-[5]">
      {placed.map((band) => (
        <div
          key={`${band.categoryId}-${String(band.startMinute)}`}
          data-kind="band"
          title={`${band.name} · ${formatBRL(band.rateCents)}/h`}
          className={`absolute overflow-hidden border-l-2 px-space-xs font-caption text-caption text-ink ${band.tone}`}
          style={{
            top: band.startMinute * pxPerMinute,
            height: (band.endMinute - band.startMinute) * pxPerMinute,
            left: `${String((band.lane / band.lanes) * 100)}%`,
            width: `${String(100 / band.lanes)}%`,
          }}
        >
          <span className="block truncate">{band.name}</span>
          <span className="block truncate">{formatBRL(band.rateCents)}/h</span>
        </div>
      ))}
      {uncovered.map((range) => (
        <div
          key={`uncovered-${String(range.startMinute)}`}
          data-kind="uncovered"
          data-start={range.startMinute}
          data-end={range.endMinute}
          title={`Horário sem categoria ${formatHHMM(range.startMinute)}–${formatHHMM(range.endMinute)}`}
          className="absolute inset-x-0 border-y border-error/70 px-space-xs font-caption text-caption text-error"
          style={{
            top: range.startMinute * pxPerMinute,
            height: (range.endMinute - range.startMinute) * pxPerMinute,
            backgroundImage:
              'repeating-linear-gradient(45deg, rgb(var(--c-error) / 0.25) 0, rgb(var(--c-error) / 0.25) 4px, transparent 4px, transparent 8px)',
          }}
        >
          Horário sem categoria
        </div>
      ))}
    </div>
  );
}

export interface CategoryOverlayPickerProps {
  categories: readonly HourlyCategory[];
  selectedIds: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
}

/** "Categorias na semana": the checkboxes that turn the bands on (PRD 7.3.1). */
export function CategoryOverlayPicker({
  categories,
  selectedIds,
  onChange,
}: CategoryOverlayPickerProps) {
  if (categories.length === 0) return null;
  return (
    <fieldset className="space-y-space-xs">
      <legend className="font-small text-small font-medium text-ink">Categorias na semana</legend>
      <div className="flex flex-wrap gap-x-space-lg gap-y-space-xs">
        {categories.map((category) => (
          <Checkbox
            key={category.id}
            label={`${category.name}${category.status === 'inactive' ? ' (inativa)' : ''}`}
            checked={selectedIds.has(category.id)}
            onChange={(event) => {
              const next = new Set(selectedIds);
              if (event.target.checked) next.add(category.id);
              else next.delete(category.id);
              onChange(next);
            }}
          />
        ))}
      </div>
    </fieldset>
  );
}
