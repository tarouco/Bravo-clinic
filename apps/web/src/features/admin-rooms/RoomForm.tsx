import { roomInputSchema } from '@bravo/core';
import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Alert } from '../../components/ui/Feedback';
import { Input, Select, Textarea } from '../../components/ui/form';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/Toast';
import { fieldErrorsOf, messageOf } from '../../lib/api-errors';
import { commitmentsOf, type Commitments } from '../../lib/commitments';
import { useCreateRoom, useUpdateRoom } from './api';
import type { AdminRoom } from './contracts';

interface FormState {
  name: string;
  slug: string;
  description: string;
  idealFor: string;
  equipment: string;
  displayOrder: string;
  status: string;
}

/** "Sala Aurora" -> "sala-aurora": a first suggestion for the address of a new room. */
export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function initialState(room: AdminRoom | null, nextOrder: number): FormState {
  if (!room) {
    return {
      name: '',
      slug: '',
      description: '',
      idealFor: '',
      equipment: '',
      displayOrder: String(nextOrder),
      status: 'active',
    };
  }
  return {
    name: room.name,
    slug: room.slug,
    description: room.description,
    idealFor: room.idealFor.join(', '),
    equipment: room.equipment.join('\n'),
    displayOrder: String(room.displayOrder),
    status: room.status,
  };
}

const splitList = (text: string, separator: RegExp): string[] =>
  text
    .split(separator)
    .map((item) => item.trim())
    .filter((item) => item !== '');

export interface RoomFormProps {
  /** `null` creates a room; a room edits it. */
  room: AdminRoom | null;
  /** Display order offered for a new room (one after the last). */
  nextOrder: number;
  /** Called with the saved room after a create, so the page can open its editor. */
  onCreated?: (room: AdminRoom) => void;
}

/**
 * Room data form (GES-103): validated with `roomInputSchema`; the API's `details[]` land on
 * their fields. Inactivating a room with future commitments is refused with a 409 that lists the
 * bookings and subscriptions to reallocate (GES-104).
 */
export function RoomForm({ room, nextOrder, onCreated }: RoomFormProps) {
  const create = useCreateRoom();
  const update = useUpdateRoom(room?.id ?? '');
  const { toast } = useToast();
  const [form, setForm] = useState<FormState>(() => initialState(room, nextOrder));
  const [slugEdited, setSlugEdited] = useState(room !== null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<Commitments | null>(null);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const submit = () => {
    setFormError(null);
    const parsed = roomInputSchema.safeParse({
      name: form.name,
      slug: form.slug,
      description: form.description,
      idealFor: splitList(form.idealFor, /,/),
      equipment: splitList(form.equipment, /\r?\n/),
      displayOrder: Number(form.displayOrder),
      status: form.status,
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

    const failed = (error: Error) => {
      const commitments = commitmentsOf(error);
      if (commitments) {
        setBlockers(commitments);
        return;
      }
      const fields = fieldErrorsOf(error);
      if (Object.keys(fields).length > 0) setErrors(fields);
      else setFormError(messageOf(error, 'Não foi possível salvar a sala.'));
    };
    if (room) {
      update.mutate(parsed.data, {
        onSuccess: () => {
          toast({ message: 'Sala salva.' });
        },
        onError: failed,
      });
    } else {
      create.mutate(parsed.data, {
        onSuccess: (created) => {
          toast({ message: 'Sala criada.' });
          onCreated?.(created);
        },
        onError: failed,
      });
    }
  };

  return (
    <>
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
            label="Nome"
            value={form.name}
            maxLength={60}
            error={errors['name']}
            onChange={(event) => {
              const name = event.target.value;
              setForm((current) => ({
                ...current,
                name,
                ...(slugEdited ? {} : { slug: slugify(name) }),
              }));
            }}
          />
          <Input
            label="Endereço da sala"
            value={form.slug}
            maxLength={40}
            error={errors['slug']}
            help="Aparece no endereço do site: /salas/endereco. Só letras minúsculas, números e hífens."
            onChange={(event) => {
              setSlugEdited(true);
              set('slug', event.target.value);
            }}
          />
        </div>
        <Textarea
          label="Descrição"
          rows={4}
          maxLength={2000}
          value={form.description}
          error={errors['description']}
          onChange={(event) => {
            set('description', event.target.value);
          }}
        />
        <Input
          label="Ideal para"
          value={form.idealFor}
          error={errors['idealFor']}
          help="Até 8 itens, separados por vírgula."
          onChange={(event) => {
            set('idealFor', event.target.value);
          }}
        />
        <Textarea
          label="Equipamentos"
          rows={5}
          value={form.equipment}
          error={errors['equipment']}
          help="Um por linha, até 30."
          onChange={(event) => {
            set('equipment', event.target.value);
          }}
        />
        <div className="grid gap-space-md sm:grid-cols-2">
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
          <Select
            label="Situação"
            value={form.status}
            error={errors['status']}
            onChange={(event) => {
              set('status', event.target.value);
            }}
          >
            <option value="active">Ativa</option>
            <option value="inactive">Inativa</option>
          </Select>
        </div>
        {formError ? <Alert tone="error">{formError}</Alert> : null}
        <Button type="submit" loading={create.isPending || update.isPending}>
          Salvar sala
        </Button>
      </form>

      <Modal
        open={blockers !== null}
        onClose={() => {
          setBlockers(null);
        }}
        title="A sala tem compromissos"
      >
        <p className="font-body text-body text-ink">
          Não é possível inativar a sala enquanto houver reservas futuras ou assinaturas de horário
          fixo nela. Remaneje estes compromissos e tente de novo:
        </p>
        <ul
          aria-label="Compromissos da sala"
          className="mt-space-sm list-disc pl-space-lg font-small text-small text-ink"
        >
          {blockers?.bookings.map((booking) => (
            <li key={`booking-${booking.code}`}>Reserva {booking.code}</li>
          ))}
          {blockers?.subscriptions.map((subscription) => (
            <li key={`subscription-${subscription.id}`}>Assinatura {subscription.id}</li>
          ))}
        </ul>
        <div className="mt-space-lg flex justify-end">
          <Button
            onClick={() => {
              setBlockers(null);
            }}
          >
            Entendi
          </Button>
        </div>
      </Modal>
    </>
  );
}
