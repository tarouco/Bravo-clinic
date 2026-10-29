import {
  manualReceiptInputSchema,
  parseBRLToCents,
  REVENUE_CATEGORIES,
  type LocalDate,
} from '@bravo/core';
import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Alert } from '../../components/ui/Feedback';
import { Input, Select, Textarea } from '../../components/ui/form';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/Toast';
import { fieldErrorsOf, messageOf } from '../../lib/api-errors';
import { CustomerPicker, type PickedCustomer } from '../admin-bookings/CustomerPicker';
import { useCreateReceipt } from './api';
import { RECEIPT_METHOD_LABELS, REVENUE_CATEGORY_LABELS } from './labels';

interface FormState {
  date: string;
  revenueCategory: string;
  method: string;
  amount: string;
  description: string;
}

/** "150,00" or "R$ 150,00" -> cents; 0 while the text is not a positive amount (the schema refuses it). */
function moneyToCents(text: string): number {
  const cents = parseBRLToCents(text);
  return cents !== null && cents > 0 ? cents : 0;
}

export interface ReceiptFormModalProps {
  /** Clinic-local date offered for a new receipt. */
  today: LocalDate;
  onClose: () => void;
}

/** Form of a manual receipt (cash, card machine or direct Pix; GES-20), with an optional customer. */
export function ReceiptFormModal({ today, onClose }: ReceiptFormModalProps) {
  const create = useCreateReceipt();
  const { toast } = useToast();
  const [form, setForm] = useState<FormState>({
    date: today,
    revenueCategory: '',
    method: '',
    amount: '',
    description: '',
  });
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const submit = () => {
    setFormError(null);
    const parsed = manualReceiptInputSchema.safeParse({
      date: form.date,
      revenueCategory: form.revenueCategory,
      method: form.method,
      amountCents: moneyToCents(form.amount),
      description: form.description,
      ...(customer ? { userId: customer.id } : {}),
    });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? 'form');
        if (!(key in next)) next[key] = issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    create.mutate(parsed.data, {
      onSuccess: () => {
        toast({ message: 'Recebimento registrado.' });
        onClose();
      },
      onError: (error) => {
        const fields = fieldErrorsOf(error);
        if (Object.keys(fields).length > 0) setErrors(fields);
        else setFormError(messageOf(error, 'Não foi possível registrar o recebimento.'));
      },
    });
  };

  return (
    <Modal open onClose={onClose} title="Novo recebimento manual">
      <form
        className="space-y-space-md"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="grid gap-space-md sm:grid-cols-2">
          <Input
            label="Data"
            type="date"
            value={form.date}
            error={errors['date']}
            onChange={(event) => {
              set('date', event.target.value);
            }}
          />
          <Input
            label="Valor"
            inputMode="decimal"
            value={form.amount}
            error={errors['amountCents']}
            help="Ex.: 150,00"
            onChange={(event) => {
              set('amount', event.target.value);
            }}
          />
        </div>
        <div className="grid gap-space-md sm:grid-cols-2">
          <Select
            label="Categoria da receita"
            value={form.revenueCategory}
            error={errors['revenueCategory']}
            onChange={(event) => {
              set('revenueCategory', event.target.value);
            }}
          >
            <option value="">Escolha a categoria</option>
            {REVENUE_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {REVENUE_CATEGORY_LABELS[category]}
              </option>
            ))}
          </Select>
          <Select
            label="Forma de recebimento"
            value={form.method}
            error={errors['method']}
            onChange={(event) => {
              set('method', event.target.value);
            }}
          >
            <option value="">Escolha a forma</option>
            {(Object.keys(RECEIPT_METHOD_LABELS) as (keyof typeof RECEIPT_METHOD_LABELS)[]).map(
              (method) => (
                <option key={method} value={method}>
                  {RECEIPT_METHOD_LABELS[method]}
                </option>
              ),
            )}
          </Select>
        </div>
        <Textarea
          label="Descrição (opcional)"
          rows={2}
          maxLength={500}
          value={form.description}
          error={errors['description']}
          onChange={(event) => {
            set('description', event.target.value);
          }}
        />
        <div className="space-y-space-xs">
          <p className="font-small text-small text-ink">Cliente (opcional)</p>
          <CustomerPicker value={customer} onChange={setCustomer} />
          {errors['userId'] ? (
            <p className="font-caption text-caption text-danger">{errors['userId']}</p>
          ) : null}
        </div>
        {formError ? <Alert tone="error">{formError}</Alert> : null}
        <div className="flex flex-wrap justify-end gap-space-sm">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={create.isPending}>
            Registrar recebimento
          </Button>
        </div>
      </form>
    </Modal>
  );
}
