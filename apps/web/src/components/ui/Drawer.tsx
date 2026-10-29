import { X } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cx } from './cx';
import { IconButton } from './IconButton';
import { useDialog } from './useDialog';

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Edge the panel slides from; defaults to the right. */
  side?: 'left' | 'right';
  /** Wider panel for tables; defaults to the narrow one. */
  wide?: boolean;
}

function DrawerPanel({
  onClose,
  title,
  children,
  side = 'right',
  wide = false,
}: Omit<DrawerProps, 'open'>) {
  const titleId = useId();
  const { panelRef, trapTab } = useDialog<HTMLDivElement>(onClose);

  return (
    <div
      className={cx(
        'bv-scrim items-stretch p-0',
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
        className={cx(
          // Pearl side sheet, 34px on the inner edge only (the outer edge meets the viewport).
          'flex h-full w-full flex-col overflow-y-auto bg-surface-raised p-space-lg text-ink shadow-panel focus:outline-none',
          side === 'right' ? 'rounded-l-xl' : 'rounded-r-xl',
          wide ? 'max-w-3xl' : 'max-w-md',
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

/** Side panel rendered in a portal: focus trap, Escape, focus restore and scroll lock. */
export function Drawer({ open, ...panel }: DrawerProps) {
  if (!open) return null;
  return createPortal(<DrawerPanel {...panel} />, document.body);
}
