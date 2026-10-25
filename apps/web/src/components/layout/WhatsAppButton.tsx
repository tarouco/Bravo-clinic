import { MessageCircle } from 'lucide-react';
import { useClinicConfig } from '../../features/config/useClinicConfig';
import { Icon } from '../ui/Icon';

/** `https://wa.me/<digits>` for an E.164 number, or the bare `https://wa.me/` while it is unknown. */
export function whatsappHref(e164: string): string {
  return `https://wa.me/${e164.replace(/\D/g, '')}`;
}

export function WhatsAppButton() {
  const { whatsappE164 } = useClinicConfig();

  return (
    <div className="fixed bottom-6 right-6 z-50">
      <a
        href={whatsappHref(whatsappE164)}
        target="_blank"
        rel="noopener noreferrer"
        title="Falar no WhatsApp da Bravô Clinic"
        className="group flex items-center gap-space-sm px-space-md py-space-sm rounded-full bg-bronze text-on-bronze shadow-[0_8px_24px_rgba(46,26,12,0.18)] hover:bg-walnut hover:shadow-[0_12px_28px_rgba(46,26,12,0.25)] transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bronze focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
      >
        <Icon as={MessageCircle} size={24} />
        <span className="font-small text-small tracking-wide pr-1 hidden sm:inline-block font-medium">
          Concierge WhatsApp
        </span>
      </a>
    </div>
  );
}
