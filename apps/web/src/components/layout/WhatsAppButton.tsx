import { MessageCircle } from 'lucide-react';
import { useClinicConfig } from '../../features/config/useClinicConfig';
import { cx } from '../ui/cx';
import { maskPhone } from '../ui/form/masked';
import { Icon } from '../ui/Icon';
import { useLightUp } from '../ui/useLightUp';

/** `https://wa.me/<digits>` for an E.164 number, or the bare `https://wa.me/` while it is unknown. */
export function whatsappHref(e164: string): string {
  return `https://wa.me/${e164.replace(/\D/g, '')}`;
}

/** `tel:+<digits>` for an E.164 number. */
export function phoneHref(e164: string): string {
  return `tel:+${e164.replace(/\D/g, '')}`;
}

/** "+5547991371524" -> "(47) 99137-1524": the clinic phone is its WhatsApp number. */
export function phoneLabel(e164: string): string {
  const digits = e164.replace(/\D/g, '');
  return maskPhone(digits.startsWith('55') && digits.length > 11 ? digits.slice(2) : digits);
}

/** Google Maps search link for an address line. */
export function mapsHref(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
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
