import { X } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button';
import { Icon } from './Icon';
import { useDialog } from './useDialog';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

function ModalPanel({ onClose, title, children }: Omit<ModalProps, 'open'>) {
  const titleId = useId();
  const { panelRef, trapTab } = useDialog<HTMLDivElement>(onClose);

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
