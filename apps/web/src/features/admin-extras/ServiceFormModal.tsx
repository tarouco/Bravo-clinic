import { extraServiceInputSchema, parseBRLToCents } from '@bravo/core';
import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Alert } from '../../components/ui/Feedback';
import { Input, Select, Textarea } from '../../components/ui/form';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/Toast';
import { fieldErrorsOf, messageOf } from '../../lib/api-errors';
import { centsToInput } from '../admin-calendar/category-utils';
import { useCreateExtraService, useUpdateExtraService } from './api';
import type { ExtraService } from './contracts';
import { SALE_MODE_LABELS, SERVICE_STATUS_LABELS, UNIT_LABELS } from './labels';

interface FormState {
  name: string;
  description: string;
  price: string;
  unit: string;
  saleMode: string;
  status: string;
  displayOrder: string;
}

function initialState(service: ExtraService | null, nextOrder: number): FormState {
  if (!service) {
    return {
      name: '',
      description: '',
      price: '',
      unit: 'hour',
      saleMode: 'quote',
      status: 'active',
      displayOrder: String(nextOrder),
    };
  }
  return {
    name: service.name,
    description: service.description,
    price: service.referencePriceCents === null ? '' : centsToInput(service.referencePriceCents),
    unit: service.unit,
    saleMode: service.saleMode,
    status: service.status,
    displayOrder: String(service.displayOrder),
  };
}

export interface ServiceFormModalProps {
  /** `null` creates a service; a service edits it. */
  service: ExtraService | null;
  /** Display order offered for a new service (one after the last). */
  nextOrder: number;
  onClose: () => void;
}

function options<T extends Record<string, string>>(labels: T) {
  return (Object.keys(labels) as (keyof T & string)[]).map((value) => (
    <option key={value} value={value}>
      {labels[value]}
    </option>
  ));
}

/**
 * Create/edit form of an extra service (GES-84): validated with `extraServiceInputSchema`, so
 * online sale without a price fails on the price field (GES-85); the API's `details[]` land on
 * their fields. A blank price means "Sob consulta".
 */
export function ServiceFormModal({ service, nextOrder, onClose }: ServiceFormModalProps) {
  const create = useCreateExtraService();
  const update = useUpdateExtraService(service?.id ?? '');
  const { toast } = useToast();
  const [form, setForm] = useState<FormState>(() => initialState(service, nextOrder));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const saving = create.isPending || update.isPending;

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const submit = () => {
    setFormError(null);
    const priceText = form.price.trim();
    const price = priceText === '' ? null : parseBRLToCents(priceText);
    if (priceText !== '' && price === null) {
      setErrors({ referencePriceCents: 'Preço inválido' });
      return;
    }
    const parsed = extraServiceInputSchema.safeParse({
      name: form.name,
      description: form.description,
      referencePriceCents: price,
      unit: form.unit,
      saleMode: form.saleMode,
      status: form.status,
      displayOrder: Number(form.displayOrder),
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

    const done = () => {
      toast({ message: service ? 'Serviço salvo.' : 'Serviço criado.' });
      onClose();
    };
    const failed = (error: Error) => {
      const fields = fieldErrorsOf(error);
      if (Object.keys(fields).length > 0) setErrors(fields);
      else setFormError(messageOf(error, 'Não foi possível salvar o serviço.'));
    };
    if (service) update.mutate(parsed.data, { onSuccess: done, onError: failed });
    else create.mutate(parsed.data, { onSuccess: done, onError: failed });
  };

  return (
    <Modal open onClose={onClose} title={service ? 'Editar serviço' : 'Novo serviço'}>
      <form
        className="space-y-space-md"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Input
          label="Nome"
          value={form.name}
          maxLength={80}
          error={errors['name']}
          onChange={(event) => {
            set('name', event.target.value);
          }}
        />
        <Textarea
          label="Descrição"
          rows={3}
          maxLength={1000}
          value={form.description}
          error={errors['description']}
          onChange={(event) => {
            set('description', event.target.value);
          }}
        />
        <div className="grid gap-space-md sm:grid-cols-2">
          <Input
            label="Preço de referência (R$)"
            inputMode="decimal"
            value={form.price}
            error={errors['referencePriceCents']}
            help="Em branco, aparece como Sob consulta."
            onChange={(event) => {
              set('price', event.target.value);
            }}
          />
          <Select
            label="Unidade"
            value={form.unit}
            error={errors['unit']}
            onChange={(event) => {
              set('unit', event.target.value);
            }}
          >
            {options(UNIT_LABELS)}
          </Select>
          <Select
            label="Forma de venda"
            value={form.saleMode}
            error={errors['saleMode']}
            onChange={(event) => {
              set('saleMode', event.target.value);
            }}
          >
            {options(SALE_MODE_LABELS)}
          </Select>
          <Select
            label="Situação"
            value={form.status}
            error={errors['status']}
            onChange={(event) => {
              set('status', event.target.value);
            }}
          >
            {options(SERVICE_STATUS_LABELS)}
          </Select>
        </div>
        <Input
          label="Ordem de exibição"
          type="number"
          min={0}
          value={form.displayOrder}
          error={errors['displayOrder']}
          onChange={(event) => {
            set('displayOrder', event.target.value);
          }}
        />
        {formError ? <Alert tone="error">{formError}</Alert> : null}
        <div className="flex flex-wrap justify-end gap-space-sm">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={saving}>
            Salvar serviço
          </Button>
        </div>
      </form>
    </Modal>
  );
}
