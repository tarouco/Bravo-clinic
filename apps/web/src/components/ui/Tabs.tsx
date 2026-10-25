import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cx, focusRing } from './cx';

export interface TabItem {
  id: string;
  label: string;
  content: ReactNode;
}

interface TabsProps {
  items: TabItem[];
  /** Accessible name of the tab list. */
  label: string;
  /** Controlled selected tab id. */
  value?: string;
  /** Initial tab id when uncontrolled; defaults to the first item. */
  defaultValue?: string;
  onValueChange?: (id: string) => void;
  className?: string;
}

/** WAI-ARIA tabs with automatic activation: arrows wrap, Home/End jump, bronze underline. */
export function Tabs({ items, label, value, defaultValue, onValueChange, className }: TabsProps) {
  const baseId = useId();
  const [internal, setInternal] = useState(defaultValue ?? items[0]?.id);
  const selected = value ?? internal;
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const select = (id: string) => {
    if (value === undefined) setInternal(id);
    onValueChange?.(id);
    tabRefs.current[id]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = items.findIndex((item) => item.id === selected);
    const last = items.length - 1;
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
        next = index >= last ? 0 : index + 1;
        break;
      case 'ArrowLeft':
        next = index <= 0 ? last : index - 1;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = last;
        break;
      default:
        return;
    }
    event.preventDefault();
    const target = items[next];
    if (target) select(target.id);
  };

  return (
    <div className={className}>
      <div
        role="tablist"
        aria-label={label}
        onKeyDown={onKeyDown}
        className="flex gap-space-lg border-b border-hairline"
      >
        {items.map((item) => {
          const isSelected = item.id === selected;
          return (
            <button
              key={item.id}
              ref={(node) => {
                tabRefs.current[item.id] = node;
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${item.id}`}
              aria-selected={isSelected}
              aria-controls={`${baseId}-panel-${item.id}`}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => select(item.id)}
              className={cx(
                '-mb-px border-b-2 px-space-xs py-space-sm font-small text-small transition-colors',
                isSelected
                  ? 'border-bronze text-bronze'
                  : 'border-transparent text-ink-muted hover:text-ink',
                focusRing,
              )}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      {items.map((item) => (
        <div
          key={item.id}
          role="tabpanel"
          id={`${baseId}-panel-${item.id}`}
          aria-labelledby={`${baseId}-tab-${item.id}`}
          hidden={item.id !== selected}
          className="pt-space-lg"
        >
          {item.content}
        </div>
      ))}
    </div>
  );
}
