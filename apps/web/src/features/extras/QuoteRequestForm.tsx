import { quoteRequestInputSchema, utcToLocal } from '@bravo/core';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '../../components/ui/Button';
import { Alert, Spinner } from '../../components/ui/Feedback';
import { Input, PhoneInput, Select, Textarea } from '../../components/ui/form';
import { ApiError } from '../../lib/api';
import { fieldErrorsOf, messageOf } from '../../lib/api-errors';
import { track } from '../../lib/analytics';
import { bookingWhen } from '../../lib/booking-time';
import { useSession } from '../auth/useSession';
import { useMyBookings } from '../booking/api';
import { useSubmitQuoteRequest, usePublicExtraServices } from './api';
import type { PublicExtraService } from './contracts';

export const QUOTE_SENT_MESSAGE = 'Pedido enviado. Retornaremos em breve.';
export const QUOTE_RATE_LIMIT_MESSAGE =
  'Você enviou muitos pedidos em pouco tempo. Tente novamente mais tarde.';

type Field =
  'serviceId' | 'name' | 'phone' | 'email' | 'description' | 'desiredOn' | 'bookingId' | 'website';

interface Values {
  name: string;
  phone: string;
  email: string;
  description: string;
  desiredOn: string;
  bookingId: string;
  /** Honeypot (GES-93): real people never see it, so it stays empty. */
  website: string;
}

const EMPTY: Values = {
  name: '',
  phone: '',
  email: '',
  description: '',
  desiredOn: '',
  bookingId: '',
  website: '',
};

const isField = (key: unknown): key is Field =>
  typeof key === 'string' &&
  ['serviceId', 'name', 'phone', 'email', 'description', 'desiredOn', 'bookingId'].includes(key);

/** Optional "Reserva vinculada" select with the signed-in tenant's upcoming bookings (GES-91). */
function LinkedBookingSelect({
  value,
  error,
  onChange,
}: {
  value: string;
  error: string | undefined;
  onChange: (value: string) => void;
}) {
  const upcoming = useMyBookings('upcoming');
  const bookings = upcoming.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <Select
      label="Reserva vinculada (opcional)"
      value={value}
      error={error}
      onChange={(event) => {
        onChange(event.target.value);
      }}
    >
      <option value="">Nenhuma</option>
      {bookings.map((booking) => (
        <option key={booking.id} value={booking.id}>
          {`${booking.code} · ${booking.roomName} · ${bookingWhen(booking.startsAt, booking.endsAt)}`}
        </option>
      ))}
    </Select>
  );
}

export interface QuoteRequestFormProps {
  /** Service to select (the visitor can still change it); updates when the prop changes. */
  serviceId?: string | undefined;
  /** Picks the initial service by its API row, for callers that only know a name. */
  preselect?: ((service: PublicExtraService) => boolean) | undefined;
  /** Secondary action under the submit button (the Home modal's WhatsApp link). */
  footer?: ReactNode;
  onSent?: (() => void) | undefined;
}

/**
 * Quote request for an extra service (GES-87, GES-97, GES-98): posts to the API, never to
 * WhatsApp. Shared by `/servicos-extras`, the Home modal and the tenant area.
 */
export function QuoteRequestForm({ serviceId, preselect, footer, onSent }: QuoteRequestFormProps) {
  const services = usePublicExtraServices();
  const { session } = useSession();
  const submit = useSubmitQuoteRequest();

  const [values, setValues] = useState<Values>(EMPTY);
  const [chosenService, setChosenService] = useState<string | null>(null);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (serviceId) setChosenService(serviceId);
  }, [serviceId]);

  const items = services.data?.items ?? [];
  const defaultService = preselect ? items.find(preselect)?.id : undefined;
  const selectedService = chosenService ?? defaultService ?? '';

  const set = (patch: Partial<Values>) => {
    setValues((current) => ({ ...current, ...patch }));
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSent(false);
    setFormError(null);
    const today = utcToLocal(new Date()).date;
    const parsed = quoteRequestInputSchema(today).safeParse({
      serviceId: selectedService,
      name: values.name,
      phone: values.phone,
      email: values.email,
      description: values.description,
      desiredOn: values.desiredOn,
      ...(values.bookingId ? { bookingId: values.bookingId } : {}),
      website: values.website,
    });
    if (!parsed.success) {
      const next: Partial<Record<Field, string>> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (isField(key) && !(key in next)) next[key] = issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    try {
      await submit.mutateAsync(parsed.data);
      track('quote_requested');
      setValues(EMPTY);
      setChosenService(null);
      setSent(true);
      onSent?.();
    } catch (error) {
      if (error instanceof ApiError && error.status === 429) {
        setFormError(QUOTE_RATE_LIMIT_MESSAGE);
        return;
      }
      const fields = fieldErrorsOf(error);
      const mapped: Partial<Record<Field, string>> = {};
      for (const [path, message] of Object.entries(fields)) {
        if (isField(path)) mapped[path] = message;
      }
      if (Object.keys(mapped).length > 0) setErrors(mapped);
      else setFormError(messageOf(error, 'Não foi possível enviar o pedido. Tente novamente.'));
    }
  };

  if (services.isPending) {
    return (
      <div className="flex justify-center py-space-lg">
        <Spinner label="Carregando serviços" />
      </div>
    );
  }

  return (
    <form noValidate className="space-y-space-md" onSubmit={(event) => void onSubmit(event)}>
      {sent ? <Alert tone="success">{QUOTE_SENT_MESSAGE}</Alert> : null}
      {formError ? <Alert tone="error">{formError}</Alert> : null}
      {services.isError ? (
        <Alert tone="error">Não foi possível carregar os serviços agora. Tente novamente.</Alert>
      ) : null}

      <Select
        label="Serviço"
        value={selectedService}
        error={errors.serviceId}
        onChange={(event) => {
          setChosenService(event.target.value);
        }}
      >
        <option value="">Escolha o serviço</option>
        {items.map((service) => (
          <option key={service.id} value={service.id}>
            {service.name}
          </option>
        ))}
      </Select>
      <Input
        label="Seu nome completo"
        autoComplete="name"
        value={values.name}
        error={errors.name}
        onChange={(event) => {
          set({ name: event.target.value });
        }}
      />
      <PhoneInput
        label="WhatsApp de contato"
        value={values.phone}
        error={errors.phone}
        onChange={(event) => {
          set({ phone: event.target.value });
        }}
      />
      <Input
        label="E-mail (opcional)"
        type="email"
        autoComplete="email"
        value={values.email}
        error={errors.email}
        onChange={(event) => {
          set({ email: event.target.value });
        }}
      />
      <Textarea
        label="O que você precisa"
        placeholder="Quantas horas, tipo de captação, prazo..."
        value={values.description}
        error={errors.description}
        onChange={(event) => {
          set({ description: event.target.value });
        }}
      />
      <Input
        label="Data desejada (opcional)"
        type="date"
        value={values.desiredOn}
        error={errors.desiredOn}
        onChange={(event) => {
          set({ desiredOn: event.target.value });
        }}
      />
      {session ? (
        <LinkedBookingSelect
          value={values.bookingId}
          error={errors.bookingId}
          onChange={(bookingId) => {
            set({ bookingId });
          }}
        />
      ) : null}

      {/* Honeypot (GES-93): off screen, skipped by Tab and by screen readers. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <input
          type="text"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          value={values.website}
          onChange={(event) => {
            set({ website: event.target.value });
          }}
        />
      </div>

      <Button type="submit" className="w-full" loading={submit.isPending}>
        Enviar pedido
      </Button>
      {footer}
    </form>
  );
}
