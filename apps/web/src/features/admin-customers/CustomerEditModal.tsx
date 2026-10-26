import { customerProfileSchema } from '@bravo/core';
import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Alert } from '../../components/ui/Feedback';
import { Input, PhoneInput } from '../../components/ui/form';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/Toast';
import { fieldErrorsOf, messageOf } from '../../lib/api-errors';
import { useUpdateCustomer } from './api';
import type { CustomerProfileView } from './contracts';
import { formatPhone } from './format';

export interface CustomerEditModalProps {
  profile: CustomerProfileView;
  onClose: () => void;
}

/** Admin edit of the name, phone, profession and registry of a customer (GES-102). */
export function CustomerEditModal({ profile, onClose }: CustomerEditModalProps) {
  const update = useUpdateCustomer(profile.id);
  const { toast } = useToast();
  const [name, setName] = useState(profile.name);
  const [phone, setPhone] = useState(profile.phone ? formatPhone(profile.phone) : '');
  const [profession, setProfession] = useState(profile.profession ?? '');
  const [registry, setRegistry] = useState(profile.professionalRegistry ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const submit = () => {
    setFormError(null);
    const parsed = customerProfileSchema.safeParse({
      name,
      ...(phone.trim() === '' ? {} : { phone }),
      profession,
      professionalRegistry: registry,
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
    update.mutate(parsed.data, {
      onSuccess: () => {
        toast({ message: 'Cadastro salvo.' });
        onClose();
      },
      onError: (error) => {
        const fields = fieldErrorsOf(error);
        if (Object.keys(fields).length > 0) setErrors(fields);
        else setFormError(messageOf(error, 'Não foi possível salvar o cadastro.'));
      },
    });
  };

  return (
    <Modal open onClose={onClose} title="Editar cadastro">
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
          value={name}
          error={errors['name']}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
        <PhoneInput
          label="Telefone"
          value={phone}
          error={errors['phone']}
          onChange={(event) => {
            setPhone(event.target.value);
          }}
        />
        <Input
          label="Profissão"
          value={profession}
          error={errors['profession']}
          onChange={(event) => {
            setProfession(event.target.value);
          }}
        />
        <Input
          label="Registro profissional"
          value={registry}
          error={errors['professionalRegistry']}
          onChange={(event) => {
            setRegistry(event.target.value);
          }}
        />
        <p className="font-caption text-caption text-ink-muted">
          O e-mail e o documento não podem ser alterados aqui.
        </p>
        {formError ? <Alert tone="error">{formError}</Alert> : null}
        <div className="flex flex-wrap justify-end gap-space-sm">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={update.isPending}>
            Salvar cadastro
          </Button>
        </div>
      </form>
    </Modal>
  );
}
