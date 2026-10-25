import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type Theme = 'day' | 'night';

export const THEME_STORAGE_KEY = 'bravo-theme';

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStoredTheme(): Theme | null {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored === 'day' || stored === 'night' ? stored : null;
  } catch {
    return null; // storage blocked (private mode, disabled cookies)
  }
}

function initialTheme(): Theme {
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  return readStoredTheme() ?? (prefersDark ? 'night' : 'day');
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useEffect(() => {
    document.documentElement.dataset['theme'] = theme;
  }, [theme]);

  const toggleTheme = useCallback(() => {
    const next: Theme = theme === 'day' ? 'night' : 'day';
    setTheme(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // The choice still applies for this session.
    }
  }, [theme]);

  const value = useMemo(() => ({ theme, toggleTheme }), [theme, toggleTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme deve ser usado dentro de ThemeProvider.');
  return context;
}
