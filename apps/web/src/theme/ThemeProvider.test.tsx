import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from './ThemeProvider';
import { ThemeToggle } from './ThemeToggle';

function stubPrefersDark(matches: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query === '(prefers-color-scheme: dark)' ? matches : false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
}

function renderToggle(): void {
  render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>,
  );
}

const html = () => document.documentElement;

beforeEach(() => {
  window.localStorage.clear();
  html().removeAttribute('data-theme');
  stubPrefersDark(false);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ThemeToggle', () => {
  it('flips data-theme day -> night -> day and writes localStorage["bravo-theme"]', async () => {
    const user = userEvent.setup();
    renderToggle();
    expect(html().dataset['theme']).toBe('day');

    await user.click(screen.getByRole('button', { name: 'Alternar tema' }));
    expect(html().dataset['theme']).toBe('night');
    expect(window.localStorage.getItem('bravo-theme')).toBe('night');

    await user.click(screen.getByRole('button', { name: 'Alternar tema' }));
    expect(html().dataset['theme']).toBe('day');
    expect(window.localStorage.getItem('bravo-theme')).toBe('day');
  });

  it('still switches the theme when localStorage.setItem throws', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    const user = userEvent.setup();
    renderToggle();

    await user.click(screen.getByRole('button', { name: 'Alternar tema' }));
    expect(html().dataset['theme']).toBe('night');
    await user.click(screen.getByRole('button', { name: 'Alternar tema' }));
    expect(html().dataset['theme']).toBe('day');
  });
});

describe('ThemeProvider initial theme', () => {
  it('starts in night when nothing is stored and the OS prefers dark', () => {
    stubPrefersDark(true);
    renderToggle();
    expect(html().dataset['theme']).toBe('night');
  });

  it('starts in day when nothing is stored and the OS does not prefer dark', () => {
    stubPrefersDark(false);
    renderToggle();
    expect(html().dataset['theme']).toBe('day');
  });

  it('lets the stored value win over the media query', () => {
    stubPrefersDark(true);
    window.localStorage.setItem('bravo-theme', 'day');
    renderToggle();
    expect(html().dataset['theme']).toBe('day');
  });

  it('lets a stored night win when the OS does not prefer dark', () => {
    stubPrefersDark(false);
    window.localStorage.setItem('bravo-theme', 'night');
    renderToggle();
    expect(html().dataset['theme']).toBe('night');
  });

  it('falls back to the media query when localStorage.getItem throws', () => {
    stubPrefersDark(true);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    renderToggle();
    expect(html().dataset['theme']).toBe('night');
  });
});

describe('index.html no-flash script', () => {
  const indexHtml = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
  const inline = /<script>([\s\S]*?)<\/script>/.exec(indexHtml)?.[1] ?? '';

  it('reads bravo-theme in an inline script that precedes the module script', () => {
    expect(inline).toContain("localStorage.getItem('bravo-theme')");
    const inlineAt = indexHtml.indexOf('<script>');
    const moduleAt = indexHtml.indexOf('<script type="module"');
    expect(inlineAt).toBeGreaterThan(-1);
    expect(moduleAt).toBeGreaterThan(inlineAt);
  });

  it('applies the stored theme, else prefers-color-scheme, before first paint', () => {
    const run = (): string | undefined => {
      html().removeAttribute('data-theme');
      // jsdom does not execute injected <script> elements here; run the shipped source directly.
      // eslint-disable-next-line @typescript-eslint/no-implied-eval, @typescript-eslint/no-unsafe-call
      new Function(inline)();
      return html().dataset['theme'];
    };

    stubPrefersDark(true);
    expect(run()).toBe('night');

    stubPrefersDark(false);
    expect(run()).toBe('day');

    stubPrefersDark(true);
    window.localStorage.setItem('bravo-theme', 'day');
    expect(run()).toBe('day');

    window.localStorage.clear();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(run()).toBe('night');
  });
});
