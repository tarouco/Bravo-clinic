import { Moon, Sun } from 'lucide-react';
import { useTheme } from './ThemeProvider';

export function ThemeToggle({ className = '' }: { className?: string }) {
  const { toggleTheme } = useTheme();

  return (
    <button
      type="button"
      aria-label="Alternar tema"
      onClick={toggleTheme}
      className={`inline-flex h-10 w-10 items-center justify-center rounded text-ink-muted transition-colors hover:bg-champagne/15 hover:text-bronze focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bronze ${className}`.trim()}
    >
      {/* Both glyphs render and `[data-theme]` picks one, so prerendered markup (GES-143) is
          the same for every visitor and hydrates without a mismatch. */}
      <Moon aria-hidden="true" strokeWidth={1.5} size={20} className="dark:hidden" />
      <Sun aria-hidden="true" strokeWidth={1.5} size={20} className="hidden dark:block" />
    </button>
  );
}
