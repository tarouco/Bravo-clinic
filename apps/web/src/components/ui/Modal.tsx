import { X } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cx } from './cx';
import { IconButton } from './IconButton';
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
    // `bv-scrim` is fixed, dimmed and blurred; under 640px the dialog becomes a bottom sheet.
    <div className="bv-scrim max-sm:items-end max-sm:p-0">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={trapTab}
        className={cx(
          'bv-modal max-h-[90vh] w-full max-w-lg overflow-y-auto focus:outline-none',
          'max-sm:max-h-[92vh] max-sm:max-w-none max-sm:rounded-b-none max-sm:px-space-lg max-sm:pb-[calc(1.5rem+env(safe-area-inset-bottom))] max-sm:pt-space-lg',
        )}
      >
        <div className="mb-space-md flex items-start justify-between gap-space-md">
          <h2 id={titleId} className="bv-modal-title">
            {title}
          </h2>
          <IconButton icon={X} label="Fechar" size="sm" className="shrink-0" onClick={onClose} />
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * Pearl dialog (`bv-modal`, radius-xl, lift-3) over the blurred scrim, rendered in a portal: focus
 * trap, Escape, focus restore and scroll lock. On phones it rises as a bottom sheet.
 */
export function Modal({ open, ...panel }: ModalProps) {
  if (!open) return null;
  return createPortal(<ModalPanel {...panel} />, document.body);
}
