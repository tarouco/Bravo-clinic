import { addDays, couponInput, localToUtc, parseBRLToCents, type LocalDate } from '@bravo/core';
import { useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { Alert } from '../../../components/ui/Feedback';
import { Checkbox, Input, Select } from '../../../components/ui/form';
import { Modal } from '../../../components/ui/Modal';
import { useToast } from '../../../components/ui/Toast';
import { centsToInput } from '../../../features/admin-calendar/category-utils';
import { useCreateCoupon, useUpdateCoupon } from '../../../features/purchases/api';
import type { Coupon } from '../../../features/purchases/types';
import { ApiError } from '../../../lib/api';
import { fieldErrorsOf, messageOf } from '../../../lib/api-errors';
import { firstValidDay, lastValidDay } from './coupon-format';

type CouponType = Coupon['type'];
type DiscountKind = Coupon['discountKind'];
type AppliesTo = Coupon['appliesTo'];

interface FormState {
  code: string;
  type: CouponType;
  discountKind: DiscountKind;
  value: string;
  appliesTo: AppliesTo;
  limitedUses: boolean;
  maxUses: string;
  limitedPerCustomer: boolean;
  perCustomerLimit: string;
  validFrom: string;
  validUntil: string;
  enabled: boolean;
}

const EMPTY: FormState = {
  code: '',
  type: 'discount',
  discountKind: 'percent',
  value: '',
  appliesTo: 'both',
  limitedUses: false,
  maxUses: '',
  limitedPerCustomer: false,
  perCustomerLimit: '',
  validFrom: '',
  validUntil: '',
  enabled: true,
};

/** 1000 basis points -> "10", 1250 -> "12,5": what the percent input shows. */
function percentToInput(basisPoints: number): string {
  return (basisPoints / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

function initialState(coupon: Coupon | null): FormState {
  if (!coupon) return EMPTY;
  return {
    code: coupon.code,
    type: coupon.type,
    discountKind: coupon.discountKind,
    value:
      coupon.discountKind === 'percent'
        ? percentToInput(coupon.discountValue)
        : centsToInput(coupon.discountValue),
    appliesTo: coupon.appliesTo,
    limitedUses: coupon.maxUses !== null,
    maxUses: coupon.maxUses === null ? '' : String(coupon.maxUses),
    limitedPerCustomer: coupon.perCustomerLimit !== null,
    perCustomerLimit: coupon.perCustomerLimit === null ? '' : String(coupon.perCustomerLimit),
    validFrom: firstValidDay(coupon) ?? '',
    validUntil: lastValidDay(coupon) ?? '',
    enabled: coupon.enabled,
  };
}

/** "10" or "12,5" -> basis points; 0 while the text is not a positive percent (the schema then refuses it). */
function percentToBasisPoints(text: string): number {
  const number = Number(text.replace('%', '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(number) && number > 0 ? Math.round(number * 100) : 0;
}

/** "20,00" or "R$ 20,00" -> cents; 0 while the text is not a positive amount. */
function moneyToCents(text: string): number {
  const cents = parseBRLToCents(text);
  return cents !== null && cents > 0 ? cents : 0;
}

/** Whole number from a text field; 0 (refused by the schema's minimum) when empty or not a whole number. */
function toCount(text: string): number {
  const number = Number(text);
  return text.trim() !== '' && Number.isInteger(number) ? number : 0;
}

const DUPLICATE_CODE_MESSAGE = 'Já existe um cupom com este código';

export interface CouponFormModalProps {
  /** `null` creates a coupon; a coupon edits it. */
  coupon: Coupon | null;
  onClose: () => void;
}

/**
 * Create/edit form of a coupon (REC-129): validated with the `couponInput` contract; percent
 * becomes basis points and money becomes cents; the API's `details[]` land on their fields.
 */
export function CouponFormModal({ coupon, onClose }: CouponFormModalProps) {
  const create = useCreateCoupon();
  const update = useUpdateCoupon(coupon?.id ?? '');
  const { toast } = useToast();
  const [form, setForm] = useState<FormState>(() => initialState(coupon));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const pending = create.isPending || update.isPending;

  const firstBooking = form.type === 'first_booking';
  const appliesTo: AppliesTo = firstBooking ? 'bookings' : form.appliesTo;

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const submit = () => {
    setFormError(null);
    const parsed = couponInput.safeParse({
      code: form.code,
      type: form.type,
      discountKind: form.discountKind,
      discountValue:
        form.discountKind === 'percent'
          ? percentToBasisPoints(form.value)
          : moneyToCents(form.value),
      appliesTo,
      maxUses: form.limitedUses ? toCount(form.maxUses) : null,
      perCustomerLimit: form.limitedPerCustomer ? toCount(form.perCustomerLimit) : null,
      validFrom: form.validFrom ? localToUtc(form.validFrom as LocalDate, 0).toISOString() : null,
      // The last valid day is inclusive: the range closes at the next local midnight.
      validUntil: form.validUntil
        ? localToUtc(addDays(form.validUntil as LocalDate, 1), 0).toISOString()
        : null,
      enabled: form.enabled,
    });

    const next: Record<string, string> = {};
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? 'form');
        if (!(key in next)) next[key] = issue.message;
      }
    } else if (
      coupon &&
      parsed.data.maxUses !== null &&
      parsed.data.maxUses < Math.max(1, coupon.usesCount)
    ) {
      next['maxUses'] =
        `O limite precisa ser pelo menos ${String(Math.max(1, coupon.usesCount))}, os usos já registrados`;
    }
    if (!parsed.success || Object.keys(next).length > 0) {
      setErrors(next);
      return;
    }
    setErrors({});

    const options = {
      onSuccess: () => {
        toast({ message: coupon ? 'Cupom salvo.' : 'Cupom criado.' });
        onClose();
      },
      onError: (error: Error) => {
        const fields = fieldErrorsOf(error);
        if (Object.keys(fields).length > 0) setErrors(fields);
        else if (error instanceof ApiError && error.status === 409) {
          setErrors({ code: error.message || DUPLICATE_CODE_MESSAGE });
        } else setFormError(messageOf(error, 'Não foi possível salvar o cupom.'));
      },
    };
    if (coupon) update.mutate(parsed.data, options);
    else create.mutate(parsed.data, options);
  };

  return (
    <Modal open onClose={onClose} title={coupon ? `Editar cupom ${coupon.code}` : 'Novo cupom'}>
      <form
        className="space-y-space-md"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Input
          label="Código"
          value={form.code}
          error={errors['code']}
          autoComplete="off"
          className="uppercase"
          help="De 3 a 30 letras, números, _ ou -"
          onChange={(event) => {
            set('code', event.target.value.toUpperCase());
          }}
        />
        <div className="grid gap-space-md sm:grid-cols-2">
          <Select
            label="Tipo"
            value={form.type}
            error={errors['type']}
            onChange={(event) => {
              set('type', event.target.value as CouponType);
            }}
          >
            <option value="discount">Desconto</option>
            <option value="first_booking">Primeira reserva</option>
          </Select>
          <Select
            label="Vale para"
            value={appliesTo}
            disabled={firstBooking}
            error={errors['appliesTo']}
            help={firstBooking ? 'Cupom de primeira reserva vale só para reservas' : undefined}
            onChange={(event) => {
              set('appliesTo', event.target.value as AppliesTo);
            }}
          >
            <option value="bookings">Reservas</option>
            <option value="packages">Pacotes</option>
            <option value="both">Reservas e pacotes</option>
          </Select>
        </div>
        <div className="grid gap-space-md sm:grid-cols-2">
          <Select
            label="Forma do desconto"
            value={form.discountKind}
            onChange={(event) => {
              set('discountKind', event.target.value as DiscountKind);
            }}
          >
            <option value="percent">Percentual (%)</option>
            <option value="fixed">Valor fixo (R$)</option>
          </Select>
          <Input
            label="Valor do desconto"
            inputMode="decimal"
            value={form.value}
            error={errors['discountValue']}
            help={form.discountKind === 'percent' ? 'Ex.: 10 para 10%' : 'Ex.: 20,00'}
            onChange={(event) => {
              set('value', event.target.value);
            }}
          />
        </div>
        <div className="grid gap-space-md sm:grid-cols-2">
          <div className="space-y-space-xs">
            <Checkbox
              label="Limitar o total de usos"
              checked={form.limitedUses}
              onChange={(event) => {
                set('limitedUses', event.target.checked);
              }}
            />
            {form.limitedUses ? (
              <Input
                label="Máximo de usos"
                type="number"
                min={1}
                inputMode="numeric"
                value={form.maxUses}
                error={errors['maxUses']}
                onChange={(event) => {
                  set('maxUses', event.target.value);
                }}
              />
            ) : (
              <p className="font-caption text-caption text-ink-muted">Usos ilimitados</p>
            )}
          </div>
          <div className="space-y-space-xs">
            <Checkbox
              label="Limitar usos por cliente"
              checked={form.limitedPerCustomer}
              onChange={(event) => {
                set('limitedPerCustomer', event.target.checked);
              }}
            />
            {form.limitedPerCustomer ? (
              <Input
                label="Usos por cliente"
                type="number"
                min={1}
                inputMode="numeric"
                value={form.perCustomerLimit}
                error={errors['perCustomerLimit']}
                onChange={(event) => {
                  set('perCustomerLimit', event.target.value);
                }}
              />
            ) : (
              <p className="font-caption text-caption text-ink-muted">Sem limite por cliente</p>
            )}
          </div>
        </div>
        <div className="grid gap-space-md sm:grid-cols-2">
          <Input
            label="Válido a partir de"
            type="date"
            value={form.validFrom}
            error={errors['validFrom']}
            onChange={(event) => {
              set('validFrom', event.target.value);
            }}
          />
          <Input
            label="Válido até (inclusive)"
            type="date"
            value={form.validUntil}
            error={errors['validUntil']}
            onChange={(event) => {
              set('validUntil', event.target.value);
            }}
          />
        </div>
        <Checkbox
          label="Cupom ativo"
          checked={form.enabled}
          onChange={(event) => {
            set('enabled', event.target.checked);
          }}
        />
        {formError ? <Alert tone="error">{formError}</Alert> : null}
        <div className="flex flex-wrap justify-end gap-space-sm">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={pending}>
            Salvar cupom
          </Button>
        </div>
      </form>
    </Modal>
  );
}
