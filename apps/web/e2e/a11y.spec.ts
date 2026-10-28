import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import {
  expect,
  test,
  type BrowserContext,
  type Cookie,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { closeE2eDb, E2E_TENANT_PASSWORD, E2E_TENANTS } from '../../api/test/e2e-seed';
import { closeReceitaDb, login, loginAdmin, projectOf } from './receita-helpers';

// GES-142 (gestao T47): axe reports zero WCAG 2.0/2.1 A and AA violations on the 13 key pages in
// the Day and Night themes, and the Admin tabs and drawers work from the keyboard alone. The theme
// is chosen the way a returning visitor's is, through `localStorage['bravo-theme']` (design.md).

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const THEMES = ['day', 'night'] as const;
type Theme = (typeof THEMES)[number];

const PUBLIC_PAGES = ['/', '/salas', '/salas/principal', '/reservar', '/servicos-extras', '/login'];
const TENANT_PAGES = ['/app', '/app/minhas-reservas', '/app/perfil/privacidade'];
const ADMIN_PAGES = [
  '/admin/reservas',
  '/admin/financeiro',
  '/admin/integracoes',
  '/admin/clientes',
];

test.afterAll(async () => {
  await closeReceitaDb();
  await closeE2eDb();
});

/**
 * Signed-in browser state of one audience in one Playwright project (each project has its own
 * tenant). A file, not memory, so the checks after a failed one still run in the new worker.
 */
type Audience = 'tenant' | 'admin';
const authFile = (audience: Audience, { project }: TestInfo) =>
  `${project.outputDir}/.auth/${project.name}-${audience}.json`;

async function saveSession(page: Page, audience: Audience, testInfo: TestInfo) {
  await page.context().storageState({ path: authFile(audience, testInfo) });
}

async function restoreSession(context: BrowserContext, audience: Audience, testInfo: TestInfo) {
  const state = JSON.parse(readFileSync(authFile(audience, testInfo), 'utf8')) as {
    cookies: Cookie[];
  };
  await context.addCookies(state.cookies);
}

async function storeTheme(page: Page, theme: Theme) {
  await page.addInitScript((value) => {
    window.localStorage.setItem('bravo-theme', value);
  }, theme);
}

/** Opens a page and waits until its data has loaded (no request in flight, no spinner). */
async function open(page: Page, path: string, theme: Theme) {
  await storeTheme(page, theme);
  await page.goto(path);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await expect(page.locator('h1').first()).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expect(page.locator('[role="status"][aria-label^="Carregando"]')).toHaveCount(0);
  // No redirect (to /login, for instance): the page under check is the one asked for.
  expect(new URL(page.url()).pathname).toBe(path.split('?')[0]);
}

async function expectNoWcagViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const summary = violations.map((v) => ({
    rule: v.id,
    impact: v.impact,
    nodes: v.nodes.map((n) => ({ target: n.target.join(' '), why: n.failureSummary })),
  }));
  expect(summary).toEqual([]);
}

test.describe('public pages', () => {
  for (const theme of THEMES) {
    for (const path of PUBLIC_PAGES) {
      test(`${path} has no WCAG A/AA violations (${theme})`, async ({ page }) => {
        await open(page, path, theme);
        await expectNoWcagViolations(page);
      });
    }
  }
});

// The sign-in test runs first (one worker, file order); the checks after it reuse its session.
test.describe('tenant pages', () => {
  test('tenant signs in', async ({ page }, testInfo) => {
    const tenant = E2E_TENANTS[projectOf(testInfo.project.name)];
    await login(page, tenant.email, E2E_TENANT_PASSWORD);
    await expect(page).toHaveURL(/\/app/);
    await saveSession(page, 'tenant', testInfo);
  });

  test.describe('signed in', () => {
    test.beforeEach(async ({ context }, testInfo) => {
      await restoreSession(context, 'tenant', testInfo);
    });
    for (const theme of THEMES) {
      for (const path of TENANT_PAGES) {
        test(`${path} has no WCAG A/AA violations (${theme})`, async ({ page }) => {
          await open(page, path, theme);
          await expectNoWcagViolations(page);
        });
      }
    }
  });
});

test.describe('admin pages', () => {
  test('admin signs in with TOTP', async ({ page }, testInfo) => {
    await loginAdmin(page);
    await saveSession(page, 'admin', testInfo);
  });

  test.describe('signed in', () => {
    test.beforeEach(async ({ context }, testInfo) => {
      await restoreSession(context, 'admin', testInfo);
    });

    for (const theme of THEMES) {
      for (const path of ADMIN_PAGES) {
        test(`${path} has no WCAG A/AA violations (${theme})`, async ({ page }) => {
          await open(page, path, theme);
          await expectNoWcagViolations(page);
        });
      }
    }

    // WAI-ARIA tabs with automatic activation: arrows move and select (wrapping), Home/End jump,
    // and only the selected tab is in the Tab order.
    const TAB_SETS = [
      {
        path: '/admin/financeiro',
        list: 'Seções do financeiro',
        tabs: ['Visão geral', 'Despesas', 'Recebimentos manuais'],
      },
      {
        path: '/admin/integracoes',
        list: 'Seções das integrações',
        tabs: ['Pagamentos', 'Calendário', 'MCP', 'E-mails', 'Consumo'],
      },
    ];
    for (const { path, list, tabs } of TAB_SETS) {
      test(`${path} tabs work from the keyboard`, async ({ page }) => {
        await open(page, path, 'day');
        const tablist = page.getByRole('tablist', { name: list });
        const tab = (name: string) => tablist.getByRole('tab', { name, exact: true });
        const expectSelected = async (name: string) => {
          await expect(tab(name)).toBeFocused();
          await expect(tab(name)).toHaveAttribute('aria-selected', 'true');
          await expect(page.getByRole('tabpanel', { name, exact: true })).toBeVisible();
        };
        const first = tabs[0] ?? '';
        const second = tabs[1] ?? '';
        const last = tabs[tabs.length - 1] ?? '';

        // Tab reaches the tab list on its selected tab, and the others are skipped.
        await page.getByRole('heading', { level: 1 }).click();
        for (let i = 0; i < 40; i++) {
          await page.keyboard.press('Tab');
          if (await tab(first).evaluate((el) => el === document.activeElement)) break;
        }
        await expectSelected(first);
        await expect(tablist.locator('[role="tab"][tabindex="0"]')).toHaveCount(1);

        await page.keyboard.press('ArrowRight');
        await expectSelected(second);
        await page.keyboard.press('End');
        await expectSelected(last);
        await page.keyboard.press('ArrowRight');
        await expectSelected(first);
        await page.keyboard.press('ArrowLeft');
        await expectSelected(last);
        await page.keyboard.press('Home');
        await expectSelected(first);

        // Tab leaves the tab list for the panel instead of walking the other tabs.
        await page.keyboard.press('Tab');
        await expect(page.locator('[role="tab"]:focus')).toHaveCount(0);
      });
    }

    test('/admin/financeiro drawer works from the keyboard', async ({ page }) => {
      await open(page, '/admin/financeiro?tab=despesas', 'day');
      const opener = page.getByRole('button', { name: 'Categorias', exact: true });
      await opener.focus();
      await page.keyboard.press('Enter');

      const drawer = page.getByRole('dialog', { name: 'Categorias de despesa' });
      await expect(drawer).toBeVisible();
      const focusInside = () => drawer.evaluate((el) => el.contains(document.activeElement));
      await expect.poll(focusInside).toBe(true);

      // Tab and Shift+Tab cycle inside the open drawer.
      const focusable = await drawer
        .locator('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled])')
        .count();
      for (let i = 0; i < focusable + 2; i++) {
        await page.keyboard.press('Tab');
        expect(await focusInside()).toBe(true);
      }
      for (let i = 0; i < focusable + 2; i++) {
        await page.keyboard.press('Shift+Tab');
        expect(await focusInside()).toBe(true);
      }

      // Escape closes it and focus returns to the button that opened it.
      await page.keyboard.press('Escape');
      await expect(drawer).toHaveCount(0);
      await expect(opener).toBeFocused();
    });
  });
});
