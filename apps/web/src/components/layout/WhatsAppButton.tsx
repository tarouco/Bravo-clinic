import { MessageCircle } from 'lucide-react';
import { useClinicConfig } from '../../features/config/useClinicConfig';
import { cx } from '../ui/cx';
import { Icon } from '../ui/Icon';
import { useLightUp } from '../ui/useLightUp';

/** `https://wa.me/<digits>` for an E.164 number, or the bare `https://wa.me/` while it is unknown. */
export function whatsappHref(e164: string): string {
  return `https://wa.me/${e164.replace(/\D/g, '')}`;
}

/** Floating emerald relief pill at the bottom-right; a round 54px button below `sm`. */
export function WhatsAppButton() {
  const { whatsappE164 } = useClinicConfig();
  const { litClass, lightUp } = useLightUp();

  return (
    <div className="fixed bottom-6 right-6 z-50">
      <a
        href={whatsappHref(whatsappE164)}
        target="_blank"
        rel="noopener noreferrer"
        title="Falar no WhatsApp da Bravô Clinic"
        onClick={lightUp}
        className={cx(
          'bv-btn bv-btn--emerald h-[54px] max-sm:w-[54px] max-sm:px-0 sm:pl-5',
          litClass,
        )}
      >
        <Icon as={MessageCircle} size={22} />
        <span className="hidden sm:inline-block">Concierge WhatsApp</span>
      </a>
    </div>
  );
}
