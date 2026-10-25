import { useState, type FormEvent } from 'react';
import { whatsappHref } from '../../../components/layout/WhatsAppButton';
import { Button } from '../../../components/ui/Button';
import { Input, PhoneInput, Textarea } from '../../../components/ui/form';
import { Modal } from '../../../components/ui/Modal';
import { useClinicConfig } from '../../../features/config/useClinicConfig';

/** WhatsApp deep link with the quote request as a pre-filled message. */
export function buildQuoteUrl(
  whatsappE164: string,
  request: { service: string; name: string; whatsapp: string; details: string },
): string {
  const message =
    `Olá! Quero um orçamento de ${request.service}.\n` +
    `Nome: ${request.name}\n` +
    `WhatsApp: ${request.whatsapp}\n` +
    `Detalhes: ${request.details}`;
  return `${whatsappHref(whatsappE164)}?text=${encodeURIComponent(message)}`;
}

interface QuoteFormProps {
  service: string;
  onClose: () => void;
}

function QuoteForm({ service, onClose }: QuoteFormProps) {
  const { whatsappE164 } = useClinicConfig();
  const [name, setName] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [details, setDetails] = useState('');
  const [errors, setErrors] = useState<{ name?: string; whatsapp?: string }>({});

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = name.trim();
    const trimmedWhatsapp = whatsapp.trim();
    const nextErrors: { name?: string; whatsapp?: string } = {};
    if (!trimmedName) nextErrors.name = 'Campo obrigatório: informe seu nome completo.';
    if (!trimmedWhatsapp) nextErrors.whatsapp = 'Campo obrigatório: informe seu WhatsApp.';
    setErrors(nextErrors);
    if (nextErrors.name || nextErrors.whatsapp) return;

    window.open(
      buildQuoteUrl(whatsappE164, {
        service,
        name: trimmedName,
        whatsapp: trimmedWhatsapp,
        details: details.trim(),
      }),
      '_blank',
      'noopener',
    );
    onClose();
  };

  return (
    <form noValidate className="space-y-space-md" onSubmit={handleSubmit}>
      <p className="-mt-space-sm font-eyebrow text-caption uppercase tracking-wider text-bronze">
        PEDIDO DE ORÇAMENTO
      </p>
      <Input
        label="Seu Nome Completo"
        placeholder="Dra. Mariana Costa"
        autoComplete="name"
        value={name}
        onChange={(event) => {
          setName(event.target.value);
        }}
        {...(errors.name ? { error: errors.name } : {})}
      />
      <PhoneInput
        label="WhatsApp de Contato"
        placeholder="(47) 98765-4321"
        value={whatsapp}
        onChange={(event) => {
          setWhatsapp(event.target.value);
        }}
        {...(errors.whatsapp ? { error: errors.whatsapp } : {})}
      />
      <Textarea
        label="Detalhes do Atendimento ou Gravação"
        placeholder="Quantas horas de atendimento, necessidade de iluminação especial ou modelo de captação..."
        rows={3}
        value={details}
        onChange={(event) => {
          setDetails(event.target.value);
        }}
      />
      <Button type="submit" className="w-full">
        Enviar Pedido pelo WhatsApp
      </Button>
    </form>
  );
}

export interface QuoteModalProps {
  /** Service being quoted; the modal is open while it is set. */
  service: string | null;
  onClose: () => void;
}

/** Quote request for an extra service: submitting hands the request over to WhatsApp. */
export function QuoteModal({ service, onClose }: QuoteModalProps) {
  return (
    <Modal open={service !== null} onClose={onClose} title={service ?? ''}>
      {service !== null ? <QuoteForm service={service} onClose={onClose} /> : null}
    </Modal>
  );
}
