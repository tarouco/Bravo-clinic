import { lazy, Suspense } from 'react';
import { whatsappHref } from '../../../components/layout/WhatsAppButton';
import { Spinner } from '../../../components/ui/Feedback';
import { Modal } from '../../../components/ui/Modal';
import { useClinicConfig } from '../../../features/config/useClinicConfig';

// The form and its zod schema load when the modal first opens, outside the Home entry chunk
// (GES-143).
const QuoteRequestForm = lazy(() =>
  import('../../../features/extras/QuoteRequestForm').then((m) => ({
    default: m.QuoteRequestForm,
  })),
);

/** WhatsApp deep link that opens a chat with the quote request as a pre-filled message. */
export function whatsappQuoteUrl(whatsappE164: string, service: string): string {
  return `${whatsappHref(whatsappE164)}?text=${encodeURIComponent(
    `Olá! Quero um orçamento de ${service}.`,
  )}`;
}

/** The service a Home card quotes: its title and how to find its row in the API catalog. */
export interface QuoteTarget {
  title: string;
  /** Matches the catalog name of the service to preselect. */
  match: RegExp;
}

export interface QuoteModalProps {
  /** Service being quoted; the modal is open while it is set. */
  service: QuoteTarget | null;
  onClose: () => void;
}

/** Quote request for an extra service: posts to the API; WhatsApp stays as a secondary action. */
export function QuoteModal({ service, onClose }: QuoteModalProps) {
  const { whatsappE164 } = useClinicConfig();
  return (
    <Modal open={service !== null} onClose={onClose} title={service?.title ?? ''}>
      {service !== null ? (
        <Suspense fallback={<Spinner label="Carregando formulário" />}>
          <QuoteRequestForm
            preselect={(row) => service.match.test(row.name)}
            footer={
              <p className="font-small text-small text-ink-muted">
                Prefere conversar?{' '}
                <a
                  className="text-bronze underline underline-offset-4 hover:text-walnut"
                  href={whatsappQuoteUrl(whatsappE164, service.title)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Pedir pelo WhatsApp
                </a>
              </p>
            }
          />
        </Suspense>
      ) : null}
    </Modal>
  );
}
