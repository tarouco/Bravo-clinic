import {
  adminCancelInput,
  balanceAdjustInput,
  formatBRL,
  manualCreditInput,
  parseBRLToCents,
} from '@bravo/core';
import { useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Alert } from '../../components/ui/Feedback';
import { Input, Textarea } from '../../components/ui/form';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/Toast';
import { fieldErrorsOf, messageOf } from '../../lib/api-errors';
import { newIdempotencyKey } from '../../lib/query-string';
import { useAdjustBalance, useAdminCancelSubscription, useGrantCredit } from '../purchases/api';
import { formatBalance } from '../purchases/format';
import type { Subscription } from '../purchases/types';

// Admin actions that change a customer's minutes or money. Each one needs a justification of
// 5..500 characters, which the API stores in the audit log (REC-43, REC-82, REC-112).

const JUSTIFICATION_HELP = 'De 5 a 500 caracteres. Fica registrada no log de auditoria.';

/** Zod issues keyed by their first path segment. */
function issuesByField(issues: readonly { path: PropertyKey[]; message: string }[]) {
  const next: Record<string, string> = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? 'form');
    if (!(key in next)) next[key] = issue.message;
  }
  return next;
}

// ---- Adjust balance (REC-43) ----

export interface AdjustBalanceDialogProps {
  subscription: Pick<Subscription, 'id' | 'category' | 'balance'>;
  onClose: () => void;
}

/** Adds or removes minutes of the active period: positive adds, negative removes. */
export function AdjustBalanceDialog({ subscription, onClose }: AdjustBalanceDialogProps) {
  const adjust = useAdjustBalance(subscription.id);
  const { toast } = useToast();
  const [minutes, setMinutes] = useState('');
  const [justification, setJustification] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const current = subscription.balance?.packageMinutes;
  const delta = minutes.trim() === '' ? Number.NaN : Number(minutes);
  const after =
    current !== undefined && Number.isInteger(delta) ? Math.max(current + delta, 0) : null;

  const submit = () => {
    setFormError(null);
    const parsed = balanceAdjustInput.safeParse({ minutes: delta, justification });
    if (!parsed.success) {
      setErrors(issuesByField(parsed.error.issues));
      return;
    }
    setErrors({});
    adjust.mutate(parsed.data, {
      onSuccess: () => {
        toast({ message: 'Saldo ajustado.' });
        onClose();
      },
      onError: (error) => {
        const fields = fieldErrorsOf(error);
        if (Object.keys(fields).length > 0) setErrors(fields);
        else setFormError(messageOf(error, 'Não foi possível ajustar o saldo.'));
      },
    });
  };

  return (
    <Modal open onClose={onClose} title="Ajustar saldo">
      <form
        className="space-y-space-md"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <p className="font-small text-small text-ink-muted">
          {subscription.category.name}
          {current !== undefined ? ` · saldo atual ${formatBalance(current)}` : ''}
        </p>
        <Input
          label="Minutos a ajustar"
          type="number"
          inputMode="numeric"
          value={minutes}
          error={errors['minutes']}
          help="Use um valor positivo para somar e negativo para tirar minutos. Ex.: 60 ou -30."
          onChange={(event) => {
            setMinutes(event.target.value);
          }}
        />
        {after !== null ? (
          <p aria-live="polite" className="font-small text-small text-ink">
            {`Saldo depois do ajuste: ${formatBalance(after)}`}
          </p>
        ) : null}
        <Textarea
          label="Justificativa"
          value={justification}
          error={errors['justification']}
          help={JUSTIFICATION_HELP}
          onChange={(event) => {
            setJustification(event.target.value);
          }}
        />
        {formError ? <Alert tone="error">{formError}</Alert> : null}
        <div className="flex flex-wrap justify-end gap-space-sm">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={adjust.isPending}>
            Ajustar saldo
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ---- Cancel (REC-82) ----

export interface AdminCancelDialogProps {
  subscription: Pick<Subscription, 'id' | 'category'>;
  customerName: string;
  onClose: () => void;
}

/** Cancels a subscription on behalf of the customer, with the justification the audit log keeps. */
export function AdminCancelDialog({ subscription, customerName, onClose }: AdminCancelDialogProps) {
  const cancel = useAdminCancelSubscription(subscription.id);
  const { toast } = useToast();
  const [justification, setJustification] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const submit = () => {
    setFormError(null);
    const parsed = adminCancelInput.safeParse({ justification });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Informe a justificativa');
      return;
    }
    setError(null);
    cancel.mutate(parsed.data, {
      onSuccess: () => {
        toast({ message: 'Assinatura cancelada.' });
        onClose();
      },
      onError: (caught) => {
        const fields = fieldErrorsOf(caught);
        if (fields['justification']) setError(fields['justification']);
        else setFormError(messageOf(caught, 'Não foi possível cancelar a assinatura.'));
      },
    });
  };

  return (
    <Modal open onClose={onClose} title="Cancelar assinatura">
      <form
        className="space-y-space-md"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <p className="font-small text-small text-ink">
          {`${subscription.category.name} de ${customerName}. O cancelamento encerra a assinatura e não pode ser desfeito.`}
        </p>
        <Textarea
          label="Justificativa"
          value={justification}
          error={error ?? undefined}
          help={JUSTIFICATION_HELP}
          onChange={(event) => {
            setJustification(event.target.value);
          }}
        />
        {formError ? <Alert tone="error">{formError}</Alert> : null}
        <div className="flex flex-wrap justify-end gap-space-sm">
          <Button variant="secondary" onClick={onClose}>
            Manter assinatura
          </Button>
          <Button
            className="text-danger"
            variant="secondary"
            type="submit"
            loading={cancel.isPending}
          >
            Confirmar cancelamento
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ---- Grant credit (REC-112) ----

export interface GrantCreditDialogProps {
  /** Customer who receives the credit. */
  userId: string;
  customerName: string;
  onClose: () => void;
}

/**
 * Manual credit for a customer (R$ 0,01 to R$ 100.000,00) with a justification. Also used by the
 * customer area of gestão, so it depends on the customer only.
 */
export function GrantCreditDialog({ userId, customerName, onClose }: GrantCreditDialogProps) {
  const grant = useGrantCredit(userId);
  const { toast } = useToast();
  // One key per dialog: a retry of the same grant must not credit the customer twice.
  const idempotencyKey = useRef(newIdempotencyKey());
  const [amount, setAmount] = useState('');
  const [justification, setJustification] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const submit = () => {
    setFormError(null);
    const amountCents = parseBRLToCents(amount);
    const parsed = manualCreditInput.safeParse({ amountCents: amountCents ?? 0, justification });
    if (!parsed.success || amountCents === null) {
      const next = parsed.success ? {} : issuesByField(parsed.error.issues);
      if (amountCents === null) next['amountCents'] = 'Informe um valor, por exemplo 50,00.';
      setErrors(next);
      return;
    }
    setErrors({});
    grant.mutate(
      { body: parsed.data, idempotencyKey: idempotencyKey.current },
      {
        onSuccess: () => {
          toast({ message: `Crédito de ${formatBRL(parsed.data.amountCents)} concedido.` });
          onClose();
        },
        onError: (error) => {
          const fields = fieldErrorsOf(error);
          if (Object.keys(fields).length > 0) setErrors(fields);
          else setFormError(messageOf(error, 'Não foi possível conceder o crédito.'));
        },
      },
    );
  };

  return (
    <Modal open onClose={onClose} title="Conceder crédito">
      <form
        className="space-y-space-md"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <p className="font-small text-small text-ink-muted">{`Cliente: ${customerName}`}</p>
        <Input
          label="Valor do crédito (R$)"
          inputMode="decimal"
          value={amount}
          error={errors['amountCents']}
          help="Entre R$ 0,01 e R$ 100.000,00. Ex.: 50,00"
          onChange={(event) => {
            setAmount(event.target.value);
          }}
        />
        <Textarea
          label="Justificativa"
          value={justification}
          error={errors['justification']}
          help={JUSTIFICATION_HELP}
          onChange={(event) => {
            setJustification(event.target.value);
          }}
        />
        {formError ? <Alert tone="error">{formError}</Alert> : null}
        <div className="flex flex-wrap justify-end gap-space-sm">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={grant.isPending}>
            Conceder crédito
          </Button>
        </div>
      </form>
    </Modal>
  );
}
