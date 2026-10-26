import { formatBRL } from '@bravo/core';
import { useId, useState } from 'react';
import { cx } from './cx';

// Hand-rolled SVG evolution chart (gestao design "Chart": no chart library). One axis in BRL:
// net revenue and expenses are bars per bucket (3 px of air between them), the result is a line
// with a marker per bucket. The SVG is decorative; the same numbers are in a table for screen
// readers (GES-27). Colors are the DESIGN.md tokens: bronze, champagne and ink, told apart by
// lightness, texture (expenses are hatched) and form (bar versus line), never by hue alone.

export type EvolutionSeries = 'net' | 'expenses' | 'result';

export interface EvolutionBucket {
  key: string;
  label: string;
  netCents: number;
  /** Negative in the finance contract (a deduction); plotted and listed as a magnitude. */
  expensesCents: number;
  resultCents: number;
}

export interface EvolutionChartProps {
  buckets: readonly EvolutionBucket[];
  series?: readonly EvolutionSeries[];
  /** Accessible name of the chart and of its data table. */
  caption?: string;
  className?: string;
}

const SERIES_LABEL: Record<EvolutionSeries, string> = {
  net: 'Receita líquida',
  expenses: 'Despesas',
  result: 'Resultado',
};

const WIDTH = 720;
const HEIGHT = 300;
const MARGIN = { top: 12, right: 12, bottom: 32, left: 64 };
const PLOT_W = WIDTH - MARGIN.left - MARGIN.right;
const PLOT_H = HEIGHT - MARGIN.top - MARGIN.bottom;
const MAX_BAR = 24;
const BAR_GAP = 3;
const MAX_X_LABELS = 8;

/** Value of a series in a bucket, in cents (expenses as a magnitude). */
function valueOf(bucket: EvolutionBucket, series: EvolutionSeries): number {
  if (series === 'net') return bucket.netCents;
  if (series === 'expenses') return Math.abs(bucket.expensesCents);
  return bucket.resultCents;
}

/** 1, 2, 2.5 or 5 times a power of ten that is at least `raw`. */
function niceStep(raw: number): number {
  const power = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / power;
  const nice =
    fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  return nice * power;
}

/** Round axis ticks (in cents, multiples of 100) spanning at least `[min, max]` and zero. */
export function niceTicks(min: number, max: number, target = 4): number[] {
  const low = Math.min(0, min);
  const high = Math.max(0, max);
  if (high === low) return [0, 10000];
  const step = Math.max(100, niceStep((high - low) / target));
  const ticks: number[] = [];
  for (
    let tick = Math.floor(low / step) * step;
    tick <= Math.ceil(high / step) * step;
    tick += step
  ) {
    ticks.push(Math.round(tick));
  }
  return ticks;
}

const compactBRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  notation: 'compact',
  maximumFractionDigits: 1,
});

/** Bar from the baseline `y0` to the value `y1`, square at the baseline, 4 px round at the tip. */
function barPath(x: number, w: number, y0: number, y1: number): string {
  const r = Math.min(4, Math.abs(y0 - y1), w / 2);
  const inset = y1 + (y0 > y1 ? r : -r);
  return `M${x},${y0} L${x},${inset} Q${x},${y1} ${x + r},${y1} L${x + w - r},${y1} Q${x + w},${y1} ${x + w},${inset} L${x + w},${y0} Z`;
}

function LegendKey({ series, hatchId }: { series: EvolutionSeries; hatchId: string }) {
  return (
    <li className="flex items-center gap-space-xs font-small text-small text-ink">
      {series === 'result' ? (
        <span aria-hidden="true" className="flex w-4 items-center">
          <span className="h-0.5 w-full bg-ink" />
          <span className="-ml-2.5 h-2 w-2 rounded-full bg-ink" />
        </span>
      ) : series === 'net' ? (
        <span aria-hidden="true" className="h-3 w-3 rounded-[2px] bg-bronze" />
      ) : (
        <svg aria-hidden="true" focusable="false" width={12} height={12}>
          <rect width={12} height={12} rx={2} fill={`url(#${hatchId})`} />
        </svg>
      )}
      {SERIES_LABEL[series]}
    </li>
  );
}

/** Net revenue, expenses and result per bucket, with legend, hover tooltip and a data table. */
export function EvolutionChart({
  buckets,
  series = ['net', 'expenses', 'result'],
  caption = 'Evolução do período',
  className,
}: EvolutionChartProps) {
  const captionId = useId();
  const hatchId = `${captionId}-hatch`;
  const [hovered, setHovered] = useState<number | null>(null);

  if (buckets.length === 0) {
    return <p className="font-small text-small text-ink-muted">Sem dados para o período.</p>;
  }

  const bars = series.filter((s): s is 'net' | 'expenses' => s !== 'result');
  const values = buckets.flatMap((bucket) => series.map((s) => valueOf(bucket, s)));
  const ticks = niceTicks(Math.min(...values), Math.max(...values));
  const domainMin = ticks[0] ?? 0;
  const domainMax = ticks[ticks.length - 1] ?? 1;
  const y = (cents: number) =>
    MARGIN.top + PLOT_H - ((cents - domainMin) / (domainMax - domainMin)) * PLOT_H;
  const y0 = y(0);

  const band = PLOT_W / buckets.length;
  const barWidth = Math.min(MAX_BAR, (band * 0.7 - BAR_GAP * (bars.length - 1)) / bars.length);
  const groupWidth = barWidth * bars.length + BAR_GAP * (bars.length - 1);
  const labelEvery = Math.ceil(buckets.length / MAX_X_LABELS);
  const centerOf = (index: number) => MARGIN.left + band * index + band / 2;

  const linePoints = buckets
    .map((bucket, index) => `${String(centerOf(index))},${String(y(valueOf(bucket, 'result')))}`)
    .join(' ');
  const active = hovered === null ? null : (buckets[hovered] ?? null);

  return (
    <figure className={cx('space-y-space-sm', className)} aria-labelledby={captionId}>
      <figcaption id={captionId} className="sr-only">
        {caption}
      </figcaption>
      {series.length > 1 ? (
        <ul aria-label="Legenda" className="flex flex-wrap gap-x-space-md gap-y-space-xs">
          {series.map((s) => (
            <LegendKey key={s} series={s} hatchId={hatchId} />
          ))}
        </ul>
      ) : null}
      <div className="relative">
        <svg
          viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`}
          aria-hidden="true"
          focusable="false"
          className="h-auto w-full"
          onMouseLeave={() => {
            setHovered(null);
          }}
        >
          <defs>
            {/* Expenses are hatched at 45 degrees: told apart from net revenue by texture, not by hue. */}
            <pattern
              id={hatchId}
              width={6}
              height={6}
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <rect width={6} height={6} className="fill-champagne" />
              <line
                x1={0}
                y1={0}
                x2={0}
                y2={6}
                strokeWidth={2.5}
                className="stroke-surface-raised"
              />
            </pattern>
          </defs>
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={MARGIN.left}
                x2={WIDTH - MARGIN.right}
                y1={y(tick)}
                y2={y(tick)}
                strokeWidth={1}
                className="stroke-hairline"
              />
              <text
                x={MARGIN.left - 8}
                y={y(tick)}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize={12}
                className="fill-ink-muted"
              >
                {compactBRL.format(tick / 100)}
              </text>
            </g>
          ))}
          {buckets.map((bucket, index) => {
            const left = centerOf(index) - groupWidth / 2;
            return (
              <g
                key={bucket.key}
                data-bucket={bucket.key}
                onMouseEnter={() => {
                  setHovered(index);
                }}
              >
                <rect
                  x={MARGIN.left + band * index}
                  y={MARGIN.top}
                  width={band}
                  height={PLOT_H}
                  fill="transparent"
                />
                {bars.map((s, barIndex) => {
                  const cents = valueOf(bucket, s);
                  if (cents === 0) return null;
                  return (
                    <path
                      key={s}
                      d={barPath(left + barIndex * (barWidth + BAR_GAP), barWidth, y0, y(cents))}
                      className={s === 'net' ? 'fill-bronze' : undefined}
                      fill={s === 'net' ? undefined : `url(#${hatchId})`}
                    />
                  );
                })}
                {index % labelEvery === 0 ? (
                  <text
                    x={centerOf(index)}
                    y={HEIGHT - 10}
                    textAnchor="middle"
                    fontSize={12}
                    className="fill-ink-muted"
                  >
                    {bucket.label}
                  </text>
                ) : null}
              </g>
            );
          })}
          {series.includes('result') ? (
            <g>
              <polyline
                points={linePoints}
                fill="none"
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                className="stroke-ink"
              />
              {buckets.map((bucket, index) => (
                <circle
                  key={bucket.key}
                  cx={centerOf(index)}
                  cy={y(valueOf(bucket, 'result'))}
                  r={4}
                  strokeWidth={2}
                  className="fill-ink stroke-surface-raised"
                />
              ))}
            </g>
          ) : null}
        </svg>
        {active && hovered !== null ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-control border border-hairline bg-surface-raised px-space-sm py-space-xs font-caption text-caption text-ink shadow-raised"
            style={{ left: `${String((centerOf(hovered) / WIDTH) * 100)}%` }}
          >
            <p className="font-medium">{active.label}</p>
            {series.map((s) => (
              <p key={s}>
                {SERIES_LABEL[s]}: {formatBRL(valueOf(active, s))}
              </p>
            ))}
          </div>
        ) : null}
      </div>
      <table className="sr-only">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Período</th>
            {series.map((s) => (
              <th key={s} scope="col">
                {SERIES_LABEL[s]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {buckets.map((bucket) => (
            <tr key={bucket.key}>
              <th scope="row">{bucket.label}</th>
              {series.map((s) => (
                <td key={s}>{formatBRL(valueOf(bucket, s))}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
