import { Moon, Sun } from 'lucide-react';
import { cx } from '../components/ui/cx';
import { iconButtonClasses } from '../components/ui/IconButton';
import { useLightUp } from '../components/ui/useLightUp';
import { useTheme } from './ThemeProvider';

/** Small pearl IconButton that switches Dia and Noite. */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const { toggleTheme } = useTheme();
  const { litClass, lightUp } = useLightUp();

  return (
    <button
      type="button"
      aria-label="Alternar tema"
      onClick={() => {
        lightUp();
        toggleTheme();
      }}
      className={cx(iconButtonClasses({ tone: 'pearl', size: 'sm' }), litClass, className)}
    >
      {/* Both glyphs render and `[data-theme]` picks one, so prerendered markup (GES-143) is
          the same for every visitor and hydrates without a mismatch. */}
      <Moon aria-hidden="true" strokeWidth={1.7} size={18} className="dark:hidden" />
      <Sun aria-hidden="true" strokeWidth={1.7} size={18} className="hidden dark:block" />
    </button>
  );
}
