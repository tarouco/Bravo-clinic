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

/**
 * WAI-ARIA tabs with automatic activation: arrows wrap, Home/End jump. The list is a sunken pill
 * track and the selected tab a raised pearl pill in weight 600 (the v3 NavBar rule, inverted).
 */
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
        className="inline-flex max-w-full gap-1 overflow-x-auto rounded-pill bg-surface-deboss p-1 shadow-deboss"
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
                'shrink-0 whitespace-nowrap rounded-pill px-4 py-2 font-small text-small transition-colors',
                isSelected
                  ? 'bg-surface-raised font-semibold text-ink shadow-[var(--lift-1),var(--rim)]'
                  : 'text-ink-muted hover:bg-glass-hover hover:text-ink',
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
