import {
  expenseInputSchema,
  parseBRLToCents,
  type ExpenseRecurrence,
  type LocalDate,
} from '@bravo/core';
import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Alert } from '../../components/ui/Feedback';
import { FileUpload } from '../../components/ui/FileUpload';
import { Input, Select } from '../../components/ui/form';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/Toast';
import { fieldErrorsOf, messageOf } from '../../lib/api-errors';
import { centsToInput } from '../admin-calendar/category-utils';
import {
  expenseAttachmentUrl,
  useCreateExpense,
  useDeleteExpenseAttachment,
  useUpdateExpense,
  useUploadExpenseAttachment,
} from './api';
import type { Expense, ExpenseCategory } from './contracts';
import { ATTACHMENT_ACCEPT, ATTACHMENT_MAX_BYTES, RECURRENCE_LABELS } from './labels';

interface FormState {
  date: string;
  categoryId: string;
  description: string;
  amount: string;
  recurrence: ExpenseRecurrence;
}

function initialState(expense: Expense | null, today: LocalDate): FormState {
  if (!expense) {
    return { date: today, categoryId: '', description: '', amount: '', recurrence: 'none' };
  }
  return {
    date: expense.date,
    categoryId: expense.categoryId,
    description: expense.description,
    amount: centsToInput(expense.amountCents),
    recurrence: expense.recurrence,
  };
}

/** "450,00" or "R$ 450,00" -> cents; 0 while the text is not a positive amount (the schema refuses it). */
function moneyToCents(text: string): number {
  const cents = parseBRLToCents(text);
  return cents !== null && cents > 0 ? cents : 0;
}

export interface ExpenseFormModalProps {
  /** `null` creates an expense; an expense edits it. */
  expense: Expense | null;
  categories: readonly ExpenseCategory[];
  /** Clinic-local date offered for a new expense. */
  today: LocalDate;
  onClose: () => void;
}

/**
 * Create/edit form of an expense (GES-11, GES-16): validated with `expenseInputSchema`; saving
 * posts (or patches) the expense and then uploads the chosen attachment; the API's `details[]`
 * land on their fields.
 */
export function ExpenseFormModal({ expense, categories, today, onClose }: ExpenseFormModalProps) {
  const create = useCreateExpense();
  const update = useUpdateExpense(expense?.id ?? '');
  const upload = useUploadExpenseAttachment();
  const removeAttachment = useDeleteExpenseAttachment();
  const { toast } = useToast();
  const [form, setForm] = useState<FormState>(() => initialState(expense, today));
  const [file, setFile] = useState<File | null>(null);
  const [attachmentGone, setAttachmentGone] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  // New expenses only offer active categories; an edited one keeps its own even if inactive.
  const options = categories.filter((c) => c.active || c.id === expense?.categoryId);
  const hasAttachment = expense?.attachmentName != null && !attachmentGone;

  const finish = (message: string) => {
    toast({ message });
    onClose();
  };

  const submit = () => {
    setFormError(null);
    const parsed = expenseInputSchema.safeParse({
      date: form.date,
      categoryId: form.categoryId,
      description: form.description,
      amountCents: moneyToCents(form.amount),
      recurrence: form.recurrence,
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
    setSaving(true);

    const saved = (result: Expense) => {
      if (!file) {
        setSaving(false);
        finish(expense ? 'Despesa salva.' : 'Despesa criada.');
        return;
      }
      upload.mutate(
        { id: result.id, file },
        {
          onSuccess: () => {
            setSaving(false);
            finish(expense ? 'Despesa salva.' : 'Despesa criada.');
          },
          onError: (error) => {
            setSaving(false);
            finish(
              `Despesa salva, mas o anexo não foi enviado: ${messageOf(error, 'tente novamente.')}`,
            );
          },
        },
      );
    };
    const failed = (error: Error) => {
      setSaving(false);
      const fields = fieldErrorsOf(error);
      if (Object.keys(fields).length > 0) setErrors(fields);
      else setFormError(messageOf(error, 'Não foi possível salvar a despesa.'));
    };

    if (expense) update.mutate(parsed.data, { onSuccess: saved, onError: failed });
    else create.mutate(parsed.data, { onSuccess: saved, onError: failed });
  };

  return (
    <Modal open onClose={onClose} title={expense ? 'Editar despesa' : 'Nova despesa'}>
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
            help="Ex.: 450,00"
            onChange={(event) => {
              set('amount', event.target.value);
            }}
          />
        </div>
        <Select
          label="Categoria"
          value={form.categoryId}
          error={errors['categoryId']}
          onChange={(event) => {
            set('categoryId', event.target.value);
          }}
        >
          <option value="">Escolha a categoria</option>
          {options.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
              {category.active ? '' : ' (inativa)'}
            </option>
          ))}
        </Select>
        <Input
          label="Descrição"
          value={form.description}
          error={errors['description']}
          maxLength={200}
          onChange={(event) => {
            set('description', event.target.value);
          }}
        />
        <Select
          label="Recorrência"
          value={form.recurrence}
          error={errors['recurrence']}
          help={
            form.recurrence === 'none'
              ? undefined
              : 'As próximas ocorrências são lançadas automaticamente no dia certo.'
          }
          onChange={(event) => {
            set('recurrence', event.target.value as ExpenseRecurrence);
          }}
        >
          {(Object.keys(RECURRENCE_LABELS) as ExpenseRecurrence[]).map((value) => (
            <option key={value} value={value}>
              {RECURRENCE_LABELS[value]}
            </option>
          ))}
        </Select>

        <div className="space-y-space-xs">
          {expense && hasAttachment ? (
            <div className="flex flex-wrap items-center gap-space-sm font-small text-small text-ink">
              <span>Anexo atual: {expense.attachmentName}</span>
              <a
                href={expenseAttachmentUrl(expense.id)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent underline underline-offset-4"
              >
                Ver anexo
              </a>
              <Button
                className="text-danger"
                variant="ghost"
                size="sm"
                loading={removeAttachment.isPending}
                onClick={() => {
                  removeAttachment.mutate(expense.id, {
                    onSuccess: () => {
                      setAttachmentGone(true);
                    },
                    onError: (error) => {
                      toast({ message: messageOf(error, 'Não foi possível remover o anexo.') });
                    },
                  });
                }}
              >
                Remover anexo
              </Button>
            </div>
          ) : null}
          <FileUpload
            label={hasAttachment ? 'Substituir anexo' : 'Anexo (nota ou comprovante)'}
            accept={ATTACHMENT_ACCEPT}
            maxBytes={ATTACHMENT_MAX_BYTES}
            help="PDF, JPEG, PNG ou WebP, até 5 MB."
            busy={upload.isPending}
            onFile={setFile}
          />
          {file ? (
            <p className="flex flex-wrap items-center gap-space-sm font-small text-small text-ink">
              Será enviado: {file.name}
              <Button
                className="text-danger"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFile(null);
                }}
              >
                Remover seleção
              </Button>
            </p>
          ) : null}
        </div>

        {formError ? <Alert tone="error">{formError}</Alert> : null}
        <div className="flex flex-wrap justify-end gap-space-sm">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={saving}>
            Salvar despesa
          </Button>
        </div>
      </form>
    </Modal>
  );
}
