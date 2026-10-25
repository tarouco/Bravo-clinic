import { X } from 'lucide-react';
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
import { Icon } from './Icon';

/** Toasts without an action dismiss themselves after this long. */
export const TOAST_DURATION_MS = 6000;

export interface ToastInput {
  message: string;
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

function ToastItem({ entry, onDismiss }: { entry: ToastEntry; onDismiss: (id: number) => void }) {
  const hasAction = Boolean(entry.action);

  useEffect(() => {
    if (hasAction) return;
    const timer = setTimeout(() => onDismiss(entry.id), TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [hasAction, entry.id, onDismiss]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-auto flex items-center gap-space-md rounded-card border border-hairline bg-surface-raised px-space-md py-space-sm font-small text-small text-ink shadow-raised"
    >
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
      <div className="pointer-events-none fixed bottom-space-lg left-1/2 z-[70] flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 flex-col gap-space-sm">
        {entries.map((entry) => (
          <ToastItem key={entry.id} entry={entry} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}
