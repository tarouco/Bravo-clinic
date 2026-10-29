import { customerCreateSchema } from '@bravo/core';
import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Alert } from '../../components/ui/Feedback';
import { DocumentInput, Input, PhoneInput } from '../../components/ui/form';
import { fieldErrorsOf, messageOf } from '../../lib/api-errors';
import { useCreateCustomer, useCustomerSearch } from '../customers/api';

export interface PickedCustomer {
  id: string;
  name: string;
  email: string;
}

export interface CustomerPickerProps {
  value: PickedCustomer | null;
  onChange: (customer: PickedCustomer | null) => void;
}

function NewCustomerForm({
  onCreated,
  onCancel,
}: {
  onCreated: (customer: PickedCustomer) => void;
  onCancel: () => void;
}) {
  const create = useCreateCustomer();
  const [form, setForm] = useState({ name: '', email: '', phone: '', document: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const set = (key: keyof typeof form) => (event: { target: { value: string } }) => {
    setForm((current) => ({ ...current, [key]: event.target.value }));
  };

  const submit = () => {
    setFormError(null);
    const parsed = customerCreateSchema.safeParse(form);
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
      onSuccess: (customer) => {
        onCreated(customer);
      },
      onError: (error) => {
        const fields = fieldErrorsOf(error);
        if (Object.keys(fields).length > 0) setErrors(fields);
        else setFormError(messageOf(error, 'Não foi possível cadastrar o cliente.'));
      },
    });
  };

  return (
    <fieldset className="space-y-space-sm rounded-md border border-hairline p-space-md">
      <legend className="px-space-xs font-small text-small text-ink">Novo cliente</legend>
      <Input
        label="Nome completo"
        value={form.name}
        error={errors['name']}
        onChange={set('name')}
      />
      <Input
        label="E-mail do cliente"
        type="email"
        value={form.email}
        error={errors['email']}
        onChange={set('email')}
      />
      <PhoneInput
        label="Telefone"
        value={form.phone}
        error={errors['phone']}
        onChange={set('phone')}
      />
      <DocumentInput
        label="CPF ou CNPJ"
        value={form.document}
        error={errors['document']}
        onChange={set('document')}
      />
      {formError ? <Alert tone="error">{formError}</Alert> : null}
      <div className="flex flex-wrap justify-end gap-space-sm">
        <Button variant="secondary" size="sm" onClick={onCancel}>
          Cancelar
        </Button>
        <Button size="sm" loading={create.isPending} onClick={submit}>
          Cadastrar cliente
        </Button>
      </div>
    </fieldset>
  );
}

/** Finds a customer by name, e-mail or document (from 2 characters) or registers a new one. */
export function CustomerPicker({ value, onChange }: CustomerPickerProps) {
  const [term, setTerm] = useState('');
  const [creating, setCreating] = useState(false);
  const search = useCustomerSearch(term);

  if (value) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-space-sm rounded-md bg-surface-deboss px-space-md py-space-sm shadow-deboss font-small text-small">
        <p className="text-ink">
          <span className="font-medium">{value.name}</span> · {value.email}
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            onChange(null);
          }}
        >
          Trocar cliente
        </Button>
      </div>
    );
  }

  if (creating) {
    return (
      <NewCustomerForm
        onCreated={(customer) => {
          setCreating(false);
          onChange(customer);
        }}
        onCancel={() => {
          setCreating(false);
        }}
      />
    );
  }

  const items = search.data?.items ?? [];
  return (
    <div className="space-y-space-sm">
      <Input
        label="Buscar cliente"
        placeholder="Nome, e-mail ou CPF"
        autoComplete="off"
        value={term}
        onChange={(event) => {
          setTerm(event.target.value);
        }}
      />
      {term.trim().length >= 2 && search.data && items.length === 0 ? (
        <p className="font-small text-small text-ink-muted">Nenhum cliente encontrado.</p>
      ) : null}
      {search.isError ? (
        <Alert tone="error">{messageOf(search.error, 'Não foi possível buscar clientes.')}</Alert>
      ) : null}
      {items.length > 0 ? (
        <ul
          aria-label="Clientes encontrados"
          className="divide-y divide-hairline overflow-hidden rounded-md bg-surface-raised shadow-card"
        >
          {items.map((customer) => (
            <li key={customer.id}>
              <button
                type="button"
                onClick={() => {
                  onChange({ id: customer.id, name: customer.name, email: customer.email });
                }}
                className="block w-full px-space-sm py-space-xs text-left font-small text-small text-ink hover:bg-glass-hover"
              >
                <span className="font-medium">{customer.name}</span> · {customer.email}
                {customer.docMasked ? ` · ${customer.docMasked}` : ''}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          setCreating(true);
        }}
      >
        Novo cliente
      </Button>
    </div>
  );
}
