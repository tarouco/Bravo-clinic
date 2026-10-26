import { X } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button';
import { cx } from './cx';
import { Icon } from './Icon';
import { useDialog } from './useDialog';

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Edge the panel slides from; defaults to the right. */
  side?: 'left' | 'right';
}

function DrawerPanel({ onClose, title, children, side = 'right' }: Omit<DrawerProps, 'open'>) {
  const titleId = useId();
  const { panelRef, trapTab } = useDialog<HTMLDivElement>(onClose);

  return (
    <div
      className={cx(
        'fixed inset-0 z-[60] flex bg-surface-night/60 backdrop-blur-sm',
        side === 'right' ? 'justify-end' : 'justify-start',
      )}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={trapTab}
        className="flex h-full w-full max-w-md flex-col overflow-y-auto bg-surface-raised p-space-lg text-ink shadow-raised focus:outline-none"
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

/** Side panel rendered in a portal: focus trap, Escape, focus restore and scroll lock. */
export function Drawer({ open, ...panel }: DrawerProps) {
  if (!open) return null;
  return createPortal(<DrawerPanel {...panel} />, document.body);
}
