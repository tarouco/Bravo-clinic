import {
  adminSaleInput,
  formatBRL,
  utcToLocal,
  type AdminSaleInput,
  type LocalDate,
} from '@bravo/core';
import { useRef, useState } from 'react';
import { CouponFieldView } from '../../components/revenue/CouponField';
import { Button } from '../../components/ui/Button';
import { Drawer } from '../../components/ui/Drawer';
import { Alert, Spinner } from '../../components/ui/Feedback';
import { Input, Select, Textarea } from '../../components/ui/form';
import { useToast } from '../../components/ui/Toast';
import { ApiError } from '../../lib/api';
import { fieldErrorsOf, messageOf } from '../../lib/api-errors';
import { newIdempotencyKey } from '../../lib/query-string';
import { CustomerPicker, type PickedCustomer } from '../admin-bookings/CustomerPicker';
import { useSession } from '../auth/useSession';
import { useCategories } from '../categories/api';
import { useAdminSubscriptionQuote, useSellSubscription } from '../purchases/api';
import { FixedSchedulePicker } from '../purchases/FixedSchedulePicker';
import { formatPeriodPrice, formatWeekdayDate } from '../purchases/format';
import { StartDateCalendar } from '../purchases/StartDateCalendar';
import { periodText } from '../purchases/subscribe-summary';

/** Default link validity of the sale, in hours (REC-150). */
const DEFAULT_HOLD_HOURS = 24;

type PayMode = 'link' | 'manual';

interface ConflictLine {
  date: string | null;
  text: string;
}

/** Dates named by a 409 `OCCURRENCE_CONFLICT` (`details[]` = `{ path: 'date', message, date }`). */
function conflictLines(error: ApiError): ConflictLine[] {
  return error.details.map((detail) => {
    const date = (detail as { date?: unknown }).date;
    return { date: typeof date === 'string' ? date : null, text: detail.message };
  });
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-space-md py-space-xs">
      <dt className="font-small text-small text-ink-muted">{label}</dt>
      <dd className="text-right font-small text-small text-ink">{value}</dd>
    </div>
  );
}

export interface SellSubscriptionDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * "Vender assinatura" (REC-150): the customer, a package category (public or admin-only), the base
 * date and, for a fixed schedule, the room; an optional coupon; and the payment as a link (hold in
 * hours) or confirmed by hand with a justification. The quote shows price and conflicts first.
 */
export function SellSubscriptionDialog({ open, onClose }: SellSubscriptionDialogProps) {
  const { toast } = useToast();
  const categories = useCategories();
  const sell = useSellSubscription();
  const today = utcToLocal(new Date()).date;

  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [categoryId, setCategoryId] = useState('');
  const [baseOnChoice, setBaseOnChoice] = useState<string | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [couponCode, setCouponCode] = useState<string | undefined>(undefined);
  const [payMode, setPayMode] = useState<PayMode>('link');
  const [holdHours, setHoldHours] = useState(String(DEFAULT_HOLD_HOURS));
  const [justification, setJustification] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<ConflictLine[] | null>(null);
  // One Idempotency-Key per distinct request body: a retry of the same sale reuses it.
  const attempt = useRef<{ body: string; key: string } | null>(null);

  const packages = (categories.data?.items ?? []).filter(
    (c) => (c.type === 'hour_package' || c.type === 'fixed_schedule') && c.status === 'active',
  );
  const category = packages.find((c) => c.id === categoryId);
  const fixed = category?.type === 'fixed_schedule';
  const baseOn = baseOnChoice ?? (category && !fixed ? today : null);

  const payment: AdminSaleInput['payment'] =
    payMode === 'link'
      ? { mode: 'link', holdHours: Number(holdHours) }
      : { mode: 'manual', justification };
  const sale: AdminSaleInput | null =
    customer && category && baseOn && (!fixed || roomId)
      ? {
          userId: customer.id,
          categoryId: category.id,
          baseOn: baseOn as LocalDate,
          ...(fixed && roomId ? { roomId } : {}),
          ...(couponCode ? { couponCode } : {}),
          payment,
        }
      : null;
  // The price does not depend on how it is paid, so the quote asks for a plain link sale.
  const quoteRequest: AdminSaleInput | null = sale ? { ...sale, payment: { mode: 'link' } } : null;
  const quoteQuery = useAdminSubscriptionQuote(quoteRequest);
  const quote = quoteQuery.data;
  const quoteConflicts = quote?.conflicts ?? [];

  const couponMessage = couponError ?? quote?.couponRejection?.message;
  const canSubmit = sale !== null && quote !== undefined && quoteConflicts.length === 0;

  const changeSale = () => {
    setConflicts(null);
    setFormError(null);
  };

  const submit = () => {
    if (!sale) return;
    setFormError(null);
    setCouponError(null);
    const parsed = adminSaleInput.safeParse(sale);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        // Payment issues name the field inside `payment` (holdHours, justification).
        const key = String(issue.path[issue.path[0] === 'payment' ? 1 : 0] ?? 'form');
        if (!(key in next)) next[key] = issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});

    const body = JSON.stringify(parsed.data);
    if (attempt.current?.body !== body) attempt.current = { body, key: newIdempotencyKey() };
    sell.mutate(
      { body: parsed.data, idempotencyKey: attempt.current.key },
      {
        onSuccess: () => {
          toast({
            message:
              payMode === 'link'
                ? 'Assinatura criada. Link enviado ao cliente.'
                : 'Assinatura criada.',
          });
          onClose();
        },
        onError: (error) => {
          const fields = fieldErrorsOf(error);
          if (error instanceof ApiError && error.code === 'OCCURRENCE_CONFLICT') {
            setConflicts(conflictLines(error));
          } else if (
            error instanceof ApiError &&
            (error.code === 'COUPON_INVALID' || error.code === 'COUPON_EXHAUSTED')
          ) {
            setCouponError(error.details[0]?.message ?? error.message);
          } else if (Object.keys(fields).length > 0) {
            const { couponCode: coupon, ...rest } = fields;
            if (coupon) setCouponError(coupon);
            setErrors(rest);
          } else setFormError(messageOf(error, 'Não foi possível criar a assinatura.'));
        },
      },
    );
  };

  return (
    <Drawer open={open} onClose={onClose} wide title="Vender assinatura">
      <form
        className="space-y-space-lg"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <section aria-labelledby="sell-customer" className="space-y-space-sm">
          <h3 id="sell-customer" className="font-h3 text-h3 text-ink">
            Cliente
          </h3>
          <CustomerPicker
            value={customer}
            onChange={(picked) => {
              setCustomer(picked);
              setCouponCode(undefined);
              changeSale();
            }}
          />
        </section>

        <section aria-labelledby="sell-category" className="space-y-space-sm">
          <h3 id="sell-category" className="font-h3 text-h3 text-ink">
            Pacote
          </h3>
          {categories.isError ? (
            <Alert tone="error">
              {messageOf(categories.error, 'Não foi possível carregar as categorias.')}
            </Alert>
          ) : (
            <Select
              label="Categoria"
              value={categoryId}
              onChange={(event) => {
                setCategoryId(event.target.value);
                setBaseOnChoice(null);
                setRoomId(null);
                setCouponCode(undefined);
                changeSale();
              }}
            >
              <option value="">Escolha a categoria</option>
              {packages.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.visibility === 'admin_only' ? `${c.name} (somente admin)` : c.name}
                </option>
              ))}
            </Select>
          )}
        </section>

        {category && !fixed ? (
          <section aria-labelledby="sell-base" className="space-y-space-sm">
            <h3 id="sell-base" className="font-h3 text-h3 text-ink">
              Data de início
            </h3>
            <StartDateCalendar
              value={baseOn}
              onSelect={(date) => {
                setBaseOnChoice(date);
                changeSale();
              }}
            />
          </section>
        ) : null}
        {category && fixed ? (
          <section aria-labelledby="sell-fixed" className="space-y-space-sm">
            <h3 id="sell-fixed" className="font-h3 text-h3 text-ink">
              Sala e início
            </h3>
            <FixedSchedulePicker
              categoryId={category.id}
              pricePerOccurrenceCents={category.pricePerOccurrenceCents ?? undefined}
              selection={{ roomId, baseOn: baseOnChoice }}
              onSelectionChange={(patch) => {
                if (patch.roomId) setRoomId(patch.roomId);
                if (patch.baseOn) setBaseOnChoice(patch.baseOn);
                changeSale();
              }}
            />
          </section>
        ) : null}

        {customer && category ? (
          <CouponFieldView
            appliedCode={couponCode}
            discountCents={quote?.discountCents ?? 0}
            rejectionMessage={couponMessage}
            onApply={(code) => {
              setCouponError(null);
              setCouponCode(code);
              changeSale();
            }}
            onRemove={() => {
              setCouponError(null);
              setCouponCode(undefined);
              changeSale();
            }}
          />
        ) : null}

        <section aria-labelledby="sell-pay" className="space-y-space-sm">
          <h3 id="sell-pay" className="font-h3 text-h3 text-ink">
            Pagamento
          </h3>
          <Select
            label="Forma de pagamento"
            value={payMode}
            onChange={(event) => {
              setPayMode(event.target.value as PayMode);
              setErrors({});
              changeSale();
            }}
          >
            <option value="link">Enviar link de pagamento ao cliente</option>
            <option value="manual">Confirmar manualmente (já recebido)</option>
          </Select>
          {payMode === 'link' ? (
            <Input
              label="Validade do link (horas)"
              type="number"
              min={1}
              max={720}
              inputMode="numeric"
              value={holdHours}
              error={errors['holdHours']}
              help="Depois desse prazo a venda expira e os horários são liberados."
              onChange={(event) => {
                setHoldHours(event.target.value);
              }}
            />
          ) : (
            <Textarea
              label="Justificativa"
              value={justification}
              error={errors['justification']}
              help="De 5 a 500 caracteres. Fica registrada no log de auditoria."
              onChange={(event) => {
                setJustification(event.target.value);
              }}
            />
          )}
        </section>

        {sale ? (
          <section aria-labelledby="sell-summary" className="space-y-space-sm">
            <h3 id="sell-summary" className="font-h3 text-h3 text-ink">
              Resumo
            </h3>
            {quoteQuery.isError ? (
              <Alert tone="error">
                {messageOf(quoteQuery.error, 'Não foi possível calcular o valor agora.')}
              </Alert>
            ) : !quote ? (
              <Spinner label="Calculando o valor" />
            ) : (
              <dl className="divide-y divide-hairline rounded-card border border-hairline bg-surface-raised px-space-md">
                <SummaryRow label="Pacote" value={category?.name ?? ''} />
                <SummaryRow label="Período" value={periodText(quote)} />
                {fixed && quote.occurrenceCount ? (
                  <SummaryRow
                    label="Ocorrências"
                    value={formatPeriodPrice(
                      quote.occurrenceCount,
                      category?.pricePerOccurrenceCents ??
                        Math.round(quote.priceCents / quote.occurrenceCount),
                    )}
                  />
                ) : null}
                <SummaryRow label="Preço" value={formatBRL(quote.priceCents)} />
                {quote.discountCents > 0 ? (
                  <SummaryRow label="Desconto" value={`− ${formatBRL(quote.discountCents)}`} />
                ) : null}
                <SummaryRow label="Total a pagar" value={formatBRL(quote.payNowCents)} />
              </dl>
            )}
          </section>
        ) : null}

        {quoteConflicts.length > 0 ? (
          <Alert tone="error">
            <p className="font-medium">Alguns horários não estão disponíveis:</p>
            <ul className="mt-space-xs list-disc space-y-1 pl-space-md">
              {quoteConflicts.map((conflict) => (
                <li key={conflict.date}>
                  {formatWeekdayDate(conflict.date)}: {conflict.label}
                </li>
              ))}
            </ul>
            <p className="mt-space-xs">Escolha outra sala ou outra data de início.</p>
          </Alert>
        ) : null}
        {conflicts ? (
          <Alert tone="error">
            <p className="font-medium">
              Alguns horários foram ocupados enquanto a venda era preparada:
            </p>
            <ul className="mt-space-xs list-disc space-y-1 pl-space-md">
              {conflicts.map((line) => (
                <li key={`${line.date ?? ''}${line.text}`}>
                  {line.date ? `${formatWeekdayDate(line.date)}: ${line.text}` : line.text}
                </li>
              ))}
            </ul>
          </Alert>
        ) : null}
        {formError ? <Alert tone="error">{formError}</Alert> : null}

        <div className="flex flex-wrap justify-end gap-space-sm">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={sell.isPending} disabled={!canSubmit}>
            Vender assinatura
          </Button>
        </div>
      </form>
    </Drawer>
  );
}

/**
 * Slot `admin.reservations.headerActions`: the "Vender assinatura" button, admin only (REC-153);
 * reception sees the Assinaturas list but cannot sell.
 */
export function SellSubscriptionAction() {
  const { session } = useSession();
  const [open, setOpen] = useState(false);
  if (session?.role !== 'admin') return null;
  return (
    <>
      <Button
        onClick={() => {
          setOpen(true);
        }}
      >
        Vender assinatura
      </Button>
      {open ? (
        <SellSubscriptionDialog
          open
          onClose={() => {
            setOpen(false);
          }}
        />
      ) : null}
    </>
  );
}
