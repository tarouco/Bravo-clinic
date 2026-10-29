import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '../ui/Button';
import { IconButton } from '../ui/IconButton';

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
  return (
    <div className="mb-space-md flex flex-wrap items-center gap-space-sm">
      <IconButton icon={ChevronLeft} label={previousLabel} size="sm" onClick={onPrevious} />
      <IconButton icon={ChevronRight} label={nextLabel} size="sm" onClick={onNext} />
      <Button variant="secondary" size="sm" onClick={onToday}>
        Hoje
      </Button>
      <h2
        aria-live="polite"
        className="ml-space-xs font-heading-mobile text-heading-mobile capitalize text-ink"
      >
        {title}
      </h2>
    </div>
  );
}
