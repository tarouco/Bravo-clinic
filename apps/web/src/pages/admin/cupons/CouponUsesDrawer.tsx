import { couponUseStatusLabel, formatBRL } from '@bravo/core';
import { Badge, type BadgeTone } from '../../../components/ui/Badge';
import { Drawer } from '../../../components/ui/Drawer';
import { Alert, Spinner } from '../../../components/ui/Feedback';
import { useCouponUses } from '../../../features/purchases/api';
import { formatDateTime } from '../../../features/purchases/format';
import type { Coupon, CouponUse } from '../../../features/purchases/types';
import { messageOf } from '../../../lib/api-errors';

const STATUS_TONES: Record<CouponUse['status'], BadgeTone> = {
  reserved: 'champagne',
  consumed: 'bronze',
  released: 'neutral',
};

/** What the coupon was used on: the booking code or the subscribed category. */
function usedOn(use: CouponUse): string {
  return use.bookingCode ?? use.subscriptionCategory ?? '—';
}

export interface CouponUsesDrawerProps {
  /** Coupon whose history is shown; `null` keeps the drawer closed. */
  coupon: Pick<Coupon, 'id' | 'code'> | null;
  onClose: () => void;
}

/** Usage history of a coupon: customer, booking or subscription, date, discount and status (REC-131). */
export function CouponUsesDrawer({ coupon, onClose }: CouponUsesDrawerProps) {
  const uses = useCouponUses(coupon?.id ?? null);

  return (
    <Drawer open={coupon !== null} onClose={onClose} title={`Usos de ${coupon?.code ?? ''}`}>
      {uses.isPending ? (
        <Spinner label="Carregando os usos" />
      ) : uses.isError ? (
        <Alert tone="error">{messageOf(uses.error, 'Não foi possível carregar os usos.')}</Alert>
      ) : uses.data.items.length === 0 ? (
        <p className="font-small text-small text-ink-muted">Este cupom ainda não foi usado.</p>
      ) : (
        <ul aria-label="Usos do cupom" className="divide-y divide-hairline/60">
          {uses.data.items.map((use) => (
            <li key={use.id} className="space-y-space-xs py-space-sm font-small text-small">
              <div className="flex flex-wrap items-center justify-between gap-space-sm">
                <span className="font-medium text-ink">{use.customerName}</span>
                <Badge tone={STATUS_TONES[use.status]}>{couponUseStatusLabel[use.status]}</Badge>
              </div>
              <p className="text-ink-muted">
                {usedOn(use)} · {formatDateTime(use.at)}
              </p>
              <p className="text-ink">{`Desconto ${formatBRL(use.discountCents)}`}</p>
            </li>
          ))}
        </ul>
      )}
    </Drawer>
  );
}
