import type { PolicySection } from '@bravo/core';
import { Checkbox } from '../ui/form';
import { cx, focusRing } from '../ui/cx';

export interface PolicyAcceptanceProps {
  sections: readonly PolicySection[];
  version: number;
  checked: boolean;
  onChange: (checked: boolean) => void;
  error?: string | undefined;
  className?: string;
}

/** Booking policy text with the required acceptance checkbox (NUC-100). */
export function PolicyAcceptance({
  sections,
  version,
  checked,
  onChange,
  error,
  className,
}: PolicyAcceptanceProps) {
  return (
    <div className={cx('space-y-space-md', className)}>
      <div
        role="region"
        aria-label="Política de reserva"
        tabIndex={0}
        className={cx(
          'max-h-64 space-y-space-md overflow-y-auto rounded-md bg-surface-deboss p-space-lg font-small text-small text-ink-muted shadow-deboss',
          focusRing,
        )}
      >
        {sections.map((section) => (
          <section key={section.title}>
            <h3 className="mb-space-xs font-heading-mobile text-body text-ink">{section.title}</h3>
            {section.paragraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </section>
        ))}
        <p className="text-caption">Versão da política: {version}</p>
      </div>
      <Checkbox
        label="Li e aceito a política de reserva"
        checked={checked}
        error={error}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
      />
    </div>
  );
}
