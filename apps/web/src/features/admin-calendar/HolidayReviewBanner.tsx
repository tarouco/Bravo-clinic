import type { LocalDate } from '@bravo/core';
import { Button } from '../../components/ui/Button';
import { Alert } from '../../components/ui/Feedback';
import { useToast } from '../../components/ui/Toast';
import { messageOf } from '../../lib/api-errors';
import { useHolidays, useImportHolidays } from '../calendar/api';

export interface HolidayReviewBannerProps {
  today: LocalDate;
  /** Opens the exceptions list on the given year. */
  onViewList: (year: number) => void;
}

/**
 * From 1 October, asks the admin to review next year's holidays when none exist yet or any is
 * marked `needsReview` (NUC-53).
 */
export function HolidayReviewBanner({ today, onViewList }: HolidayReviewBannerProps) {
  const nextYear = Number(today.slice(0, 4)) + 1;
  const seasonOpen = Number(today.slice(5, 7)) >= 10;
  const holidays = useHolidays(nextYear);
  const importNational = useImportHolidays();
  const { toast } = useToast();

  if (!seasonOpen || !holidays.data) return null;
  const items = holidays.data.items;
  if (items.length > 0 && !items.some((holiday) => holiday.needsReview)) return null;

  return (
    <Alert tone="info">
      <div className="flex flex-wrap items-center justify-between gap-space-sm">
        <p className="font-medium">Confira os feriados de {nextYear}</p>
        <div className="flex flex-wrap gap-space-sm">
          <Button
            size="sm"
            loading={importNational.isPending}
            onClick={() => {
              importNational.mutate(
                { year: nextYear },
                {
                  onSuccess: () => {
                    toast({ message: `Feriados nacionais de ${String(nextYear)} importados.` });
                  },
                  onError: (error) => {
                    toast({ message: messageOf(error, 'Não foi possível importar os feriados.') });
                  },
                },
              );
            }}
          >
            Importar nacionais
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              onViewList(nextYear);
            }}
          >
            Ver lista
          </Button>
        </div>
      </div>
    </Alert>
  );
}
