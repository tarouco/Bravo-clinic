import { X } from 'lucide-react';
import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button';
import { Icon } from './Icon';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function ModalPanel({ onClose, title, children }: Omit<ModalProps, 'open'>) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Focus moves in on open and back to the opener on close; the page behind does not scroll.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();

    const onDocumentKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onDocumentKeyDown);

    return () => {
      document.removeEventListener('keydown', onDocumentKeyDown);
      document.body.style.overflow = previousOverflow;
      opener?.focus();
    };
  }, []);

  // Tab cycles within the dialog: last -> first, and Shift+Tab first -> last.
  const trapTab = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;
    const focusable = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) {
      event.preventDefault();
      return;
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-surface-night/60 p-space-md backdrop-blur-sm">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={trapTab}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-card bg-surface-raised p-space-lg text-ink shadow-raised focus:outline-none"
      >
        <div className="mb-space-md flex items-start justify-between gap-space-md">
          <h2 id={titleId} className="font-heading text-heading-mobile text-ink">
            {title}
          </h2>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Fechar"
            className="w-10 shrink-0 px-0"
            onClick={onClose}
          >
            <Icon as={X} />
          </Button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Accessible dialog rendered in a portal: focus trap, Escape, focus restore and scroll lock. */
export function Modal({ open, ...panel }: ModalProps) {
  if (!open) return null;
  return createPortal(<ModalPanel {...panel} />, document.body);
}
