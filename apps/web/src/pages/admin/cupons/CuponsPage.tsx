import { useEffect, useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { cx, focusRing } from '../../../components/ui/cx';
import { Alert, Spinner } from '../../../components/ui/Feedback';
import { Table, type TableColumn } from '../../../components/ui/Table';
import { useToast } from '../../../components/ui/Toast';
import { useCoupons, useToggleCoupon } from '../../../features/purchases/api';
import type { Coupon } from '../../../features/purchases/types';
import { messageOf } from '../../../lib/api-errors';
import { usePageTitle } from '../../../lib/usePageTitle';
import {
  COUPON_TYPE_LABELS,
  couponDiscountText,
  couponUsesText,
  couponValidityText,
} from './coupon-format';
import { CouponUsesDrawer } from './CouponUsesDrawer';

/**
 * Enabled switch of one coupon. It flips at once (optimistic) and goes back, with a toast, when the
 * API refuses the change (REC-130).
 */
function EnabledSwitch({ coupon }: { coupon: Coupon }) {
  const toggle = useToggleCoupon(coupon.id);
  const { toast } = useToast();
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const shown = optimistic ?? coupon.enabled;

  // The refetched list replaces the optimistic value as soon as it carries the new state.
  useEffect(() => {
    setOptimistic(null);
  }, [coupon.enabled]);

  const flip = () => {
    const next = !shown;
    setOptimistic(next);
    toggle.mutate(next, {
      onError: (error) => {
        setOptimistic(null);
        toast({ message: messageOf(error, 'Não foi possível alterar o cupom.') });
      },
    });
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={shown}
      aria-label={`Cupom ${coupon.code} ativo`}
      onClick={flip}
      className={cx(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
        shown ? 'bg-bronze' : 'bg-border',
        focusRing,
      )}
    >
      <span
        aria-hidden="true"
        className={cx(
          'inline-block h-5 w-5 rounded-full bg-surface-raised shadow transition-transform',
          shown ? 'translate-x-5' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}

/** `/admin/cupons`: every coupon with its usage, validity and enabled switch (REC-128). */
export function CuponsPage() {
  usePageTitle('Cupons');
  const coupons = useCoupons();
  const [, setFormTarget] = useState<Coupon | 'new' | null>(null);
  const [usesOf, setUsesOf] = useState<Coupon | null>(null);

  const columns: readonly TableColumn<Coupon>[] = [
    {
      id: 'code',
      header: 'Código',
      sortValue: (c) => c.code,
      cell: (c) => <span className="font-medium">{c.code}</span>,
    },
    { id: 'type', header: 'Tipo', cell: (c) => COUPON_TYPE_LABELS[c.type] },
    { id: 'discount', header: 'Desconto', cell: (c) => couponDiscountText(c) },
    { id: 'uses', header: 'Usos', cell: (c) => couponUsesText(c) },
    { id: 'validity', header: 'Validade', cell: (c) => couponValidityText(c) },
    { id: 'enabled', header: 'Ativo', cell: (c) => <EnabledSwitch coupon={c} /> },
    {
      id: 'actions',
      header: 'Ações',
      cell: (c) => (
        <div className="flex flex-wrap gap-space-xs">
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Editar ${c.code}`}
            onClick={() => {
              setFormTarget(c);
            }}
          >
            Editar
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Ver usos de ${c.code}`}
            onClick={() => {
              setUsesOf(c);
            }}
          >
            Usos
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-space-lg">
      <div className="flex flex-wrap items-center justify-between gap-space-sm">
        <h1 className="font-heading text-heading-mobile text-ink md:text-heading">Cupons</h1>
        <Button
          onClick={() => {
            setFormTarget('new');
          }}
        >
          Novo cupom
        </Button>
      </div>
      {coupons.isPending ? <Spinner label="Carregando os cupons" /> : null}
      {coupons.isError ? (
        <Alert tone="error">
          {messageOf(coupons.error, 'Não foi possível carregar os cupons agora.')}
        </Alert>
      ) : null}
      {coupons.data ? (
        <Table
          caption="Cupons de desconto"
          columns={columns}
          rows={coupons.data.items}
          rowKey={(c) => c.id}
          emptyMessage="Nenhum cupom cadastrado."
        />
      ) : null}
      <CouponUsesDrawer
        coupon={usesOf}
        onClose={() => {
          setUsesOf(null);
        }}
      />
    </div>
  );
}
