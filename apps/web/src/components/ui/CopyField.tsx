import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { Button } from './Button';
import { cx } from './cx';

export interface CopyFieldProps {
  label: string;
  value: string;
  /** Accessible name of the copy button. */
  buttonLabel?: string;
  className?: string;
}

/** Read-only value with a button that copies it to the clipboard (Pix copia e cola, links). */
export function CopyField({ label, value, buttonLabel = 'Copiar', className }: CopyFieldProps) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setFailed(false);
    } catch {
      setCopied(false);
      setFailed(true);
    }
  };

  return (
    <div className={cx('space-y-space-xs', className)}>
      <label className="block font-small text-small text-ink">
        {label}
        <input
          readOnly
          value={value}
          onFocus={(event) => {
            event.currentTarget.select();
          }}
          className="mt-space-xs h-12 w-full rounded-control border border-border bg-surface-raised px-space-md font-mono text-small text-ink"
        />
      </label>
      <Button
        variant="secondary"
        size="sm"
        leadingIcon={copied ? Check : Copy}
        onClick={() => void copy()}
      >
        {buttonLabel}
      </Button>
      <span role="status" className="ml-space-sm font-small text-small text-ink-muted">
        {copied ? 'Copiado.' : failed ? 'Não foi possível copiar. Selecione o texto acima.' : ''}
      </span>
    </div>
  );
}
