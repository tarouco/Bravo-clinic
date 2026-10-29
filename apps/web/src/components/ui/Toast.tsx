import { CircleAlert, CircleCheck, Info, X, type LucideIcon } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Button } from './Button';
import { cx } from './cx';
import { Icon } from './Icon';

/** Toasts without an action dismiss themselves after this long. */
export const TOAST_DURATION_MS = 6000;

export type ToastTone = 'info' | 'success' | 'error';

export interface ToastInput {
  message: string;
  /** Icon and its color; defaults to `info`. */
  tone?: ToastTone;
  /** A toast with an action stays until the user acts on it or dismisses it. */
  action?: { label: string; onAction: () => void };
}

interface ToastEntry extends ToastInput {
  id: number;
}

interface ToastContextValue {
  toast: (input: ToastInput) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside <ToastProvider>');
  return context;
}

const TONE_ICONS: Record<ToastTone, { icon: LucideIcon; className: string }> = {
  info: { icon: Info, className: 'text-accent' },
  success: { icon: CircleCheck, className: 'text-emerald dark:text-neon' },
  error: { icon: CircleAlert, className: 'text-danger' },
};

function ToastItem({ entry, onDismiss }: { entry: ToastEntry; onDismiss: (id: number) => void }) {
  const hasAction = Boolean(entry.action);
  const tone = TONE_ICONS[entry.tone ?? 'info'];

  useEffect(() => {
    if (hasAction) return;
    const timer = setTimeout(() => onDismiss(entry.id), TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [hasAction, entry.id, onDismiss]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-auto flex items-center gap-space-sm rounded-md bg-surface-raised py-space-sm pl-5 pr-2 font-small text-small text-ink shadow-panel"
    >
      <Icon as={tone.icon} size={18} className={cx('shrink-0', tone.className)} />
      <span className="flex-1">{entry.message}</span>
      {entry.action ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            entry.action?.onAction();
            onDismiss(entry.id);
          }}
        >
          {entry.action.label}
        </Button>
      ) : null}
      <Button
        variant="ghost"
        size="sm"
        aria-label="Dispensar aviso"
        className="w-10 shrink-0 px-0"
        onClick={() => onDismiss(entry.id)}
      >
        <Icon as={X} size={16} />
      </Button>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<ToastEntry[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setEntries((current) => current.filter((entry) => entry.id !== id));
  }, []);

  const toast = useCallback((input: ToastInput) => {
    const id = nextId.current++;
    setEntries((current) => [...current, { ...input, id }]);
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Above the app's floating tab bar on phones (AppShell); 24px from the edge from lg. Inset, not
          left-1/2 + translate: an untranslated box past the edge widens the mobile layout viewport. */}
      <div className="pointer-events-none fixed inset-x-4 bottom-[calc(6rem+env(safe-area-inset-bottom))] z-[70] mx-auto flex max-w-md flex-col gap-space-sm lg:bottom-space-lg">
        {entries.map((entry) => (
          <ToastItem key={entry.id} entry={entry} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}
