import { Paperclip } from 'lucide-react';
import { useId, useState, type ChangeEvent } from 'react';
import { buttonClasses } from './Button';
import { cx } from './cx';
import { Icon } from './Icon';

export interface FileUploadProps {
  /** Visible label of the control ("Anexo"). */
  label: string;
  /** Allowed media types, as in the `accept` attribute (`application/pdf,image/png`). */
  accept: string;
  /** Largest file in bytes; a bigger file is refused before `onFile` is called. */
  maxBytes: number;
  onFile: (file: File) => void;
  /** Upload progress 0..1 shown as a bar; `busy` shows an indeterminate state instead. */
  progress?: number | undefined;
  busy?: boolean | undefined;
  disabled?: boolean | undefined;
  /** Message from the caller (for example the API's 413/415), shown like a local refusal. */
  error?: string | undefined;
  help?: string | undefined;
  className?: string;
}

/** 5242880 -> "5 MB", 1572864 -> "1,5 MB" (binary megabytes, the API's 5 MiB limit). */
export function formatMaxBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
}

function accepts(accept: string, file: File): boolean {
  const allowed = accept
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  if (allowed.length === 0) return true;
  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  return allowed.some((rule) => {
    if (rule.startsWith('.')) return name.endsWith(rule);
    if (rule.endsWith('/*')) return type.startsWith(rule.slice(0, -1));
    return type === rule;
  });
}

/** File picker that checks type and size in the browser before handing the file over. */
export function FileUpload({
  label,
  accept,
  maxBytes,
  onFile,
  progress,
  busy = false,
  disabled = false,
  error,
  help,
  className,
}: FileUploadProps) {
  const id = useId();
  const [localError, setLocalError] = useState<string | null>(null);
  const shownError = localError ?? error;

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Clearing the value lets the same file be picked again after a refusal.
    event.target.value = '';
    if (!file) return;
    if (file.size > maxBytes) {
      setLocalError(`Arquivo maior que ${formatMaxBytes(maxBytes)}`);
      return;
    }
    if (!accepts(accept, file)) {
      setLocalError('Formato não suportado');
      return;
    }
    setLocalError(null);
    onFile(file);
  };

  return (
    <div className={cx('space-y-space-xs', className)}>
      <label htmlFor={id} className="block font-small text-small font-medium text-ink">
        {label}
      </label>
      <div className="flex flex-wrap items-center gap-space-sm">
        <input
          id={id}
          type="file"
          accept={accept}
          disabled={disabled || busy}
          onChange={onChange}
          aria-invalid={shownError ? true : undefined}
          aria-describedby={shownError ? `${id}-error` : help ? `${id}-help` : undefined}
          className="peer sr-only"
        />
        <label
          htmlFor={id}
          className={cx(
            // The pearl pill of a secondary Button; the outline mirrors bv-btn's keyboard focus.
            buttonClasses({ variant: 'secondary', size: 'sm' }),
            'peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-accent',
            (disabled || busy) && 'cursor-not-allowed opacity-[0.42] shadow-none',
          )}
        >
          <Icon as={Paperclip} size={16} />
          Escolher arquivo
        </label>
        {busy && progress === undefined ? (
          <span role="status" className="font-small text-small text-ink-muted">
            Enviando…
          </span>
        ) : null}
        {progress !== undefined ? (
          <progress
            value={progress}
            max={1}
            aria-label={`Progresso do envio de ${label}`}
            className="h-2 w-40 accent-emerald"
          />
        ) : null}
      </div>
      {help && !shownError ? (
        <p id={`${id}-help`} className="font-caption text-caption text-ink-muted">
          {help}
        </p>
      ) : null}
      {shownError ? (
        <p id={`${id}-error`} role="alert" className="font-caption text-caption text-danger">
          {shownError}
        </p>
      ) : null}
    </div>
  );
}
