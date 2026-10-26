import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '../ui/Button';
import { cx, focusRing } from '../ui/cx';
import { Icon } from '../ui/Icon';

export interface ScheduleToolbarProps {
  title: string;
  previousLabel: string;
  nextLabel: string;
  onPrevious: () => void;
  onNext: () => void;
  onToday: () => void;
}

/** Previous / next / today navigation with the period title. */
export function ScheduleToolbar({
  title,
  previousLabel,
  nextLabel,
  onPrevious,
  onNext,
  onToday,
}: ScheduleToolbarProps) {
  const arrow = cx(
    'flex h-10 w-10 items-center justify-center rounded-control border border-border bg-surface-raised text-bronze',
    focusRing,
  );
  return (
    <div className="mb-space-sm flex flex-wrap items-center gap-space-sm">
      <button type="button" aria-label={previousLabel} className={arrow} onClick={onPrevious}>
        <Icon as={ChevronLeft} />
      </button>
      <button type="button" aria-label={nextLabel} className={arrow} onClick={onNext}>
        <Icon as={ChevronRight} />
      </button>
      <Button variant="secondary" size="sm" onClick={onToday}>
        Hoje
      </Button>
      <h2 aria-live="polite" className="font-heading-mobile text-body capitalize text-ink">
        {title}
      </h2>
    </div>
  );
}
