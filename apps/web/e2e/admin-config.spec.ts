import ExcelJS from 'exceljs';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { closeE2eDb } from '../../api/test/e2e-seed';
import { closeHelpersDb, query } from './helpers/db';
import { parseIcs } from './helpers/ics';
import { closeReceitaDb, loginAdmin, runTag } from './receita-helpers';

// GES-141 (gestao T46): the admin logs in with password + TOTP (computed with otpauth), changes a
// category price, creates an expense with a PDF attachment, exports the DRE and finds its 7 lines,
// issues a clinic calendar link that returns a VCALENDAR, issues an MCP token whose `tools/list`
// succeeds over HTTP, and revokes it.

const CATEGORY = '1 hora — noite';
let restoreWeekendCents: number | null = null;

test.afterAll(async () => {
  // Leave the price the other specs book with.
  if (restoreWeekendCents !== null) {
    await query(`update booking_categories set weekend_rate_cents = $1 where name = $2`, [
      restoreWeekendCents,
      CATEGORY,
    ]);
  }
  await closeHelpersDb();
  await closeReceitaDb();
  await closeE2eDb();
});

interface CatalogHourly {
  name: string;
  weekendRateCents: number;
}

async function weekendRate(request: APIRequestContext): Promise<number> {
  const response = await request.get('/api/public/catalog');
  expect(response.ok()).toBe(true);
  const { hourly } = (await response.json()) as { hourly: CatalogHourly[] };
  const category = hourly.find((c) => c.name === CATEGORY);
  if (category === undefined) throw new Error(`${CATEGORY} missing from the catalog`);
  return category.weekendRateCents;
}

/** One JSON-RPC call to the MCP endpoint with a bearer token (stateless streamable HTTP). */
function mcpCall(request: APIRequestContext, path: string, token: string, method: string) {
  return request.post(path, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
    },
    data: {
      jsonrpc: '2.0',
      id: 1,
      method,
      params:
        method === 'initialize'
          ? {
              protocolVersion: '2025-06-18',
              capabilities: {},
              clientInfo: { name: 'bravo-e2e', version: '1.0.0' },
            }
          : {},
    },
  });
}

/** A minimal PDF: the API checks the `%PDF-` magic bytes against the content type. */
const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n',
  'latin1',
);

test('admin configures prices, finance, calendar link and MCP access', async ({
  page,
  request,
}) => {
  const tag = runTag();

  // Password + TOTP (FND-67).
  await loginAdmin(page);
  await expect(page).toHaveURL(/\/admin/);

  // Category price: weekend rate of "1 hora — noite" 120,00 → 125,00.
  const before = await weekendRate(request);
  restoreWeekendCents = before;
  const next = before + 500;
  await page.goto('/admin/calendario');
  await page.getByRole('tab', { name: 'Valores' }).click();
  const weekendInput = page.getByLabel(`Fim de semana e feriados de ${CATEGORY}`);
  await weekendInput.fill((next / 100).toFixed(2).replace('.', ','));
  await page.getByRole('button', { name: `Salvar ${CATEGORY}` }).click();
  await expect(page.getByText(`Categoria "${CATEGORY}" salva.`)).toBeVisible();
  await expect.poll(() => weekendRate(request)).toBe(next);

  // Expense with a PDF attachment.
  const description = `Conta de luz ${tag}`;
  await page.goto('/admin/financeiro');
  await page.getByRole('tab', { name: 'Despesas' }).click();
  await page.getByRole('button', { name: 'Nova despesa' }).click();
  const form = page.getByRole('dialog', { name: 'Nova despesa' });
  await form.getByLabel('Valor').fill('450,00');
  await form.getByLabel('Categoria').selectOption({ label: 'Energia' });
  await form.getByLabel('Descrição').fill(description);
  await form.getByLabel('Anexo (nota ou comprovante)').setInputFiles({
    name: 'conta-de-luz.pdf',
    mimeType: 'application/pdf',
    buffer: PDF,
  });
  await expect(form.getByText('Será enviado: conta-de-luz.pdf')).toBeVisible();
  await form.getByRole('button', { name: 'Salvar despesa' }).click();
  await expect(page.getByText('Despesa criada.', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: `Ver anexo de ${description}` })).toBeVisible();
  const [expense] = await query<{
    id: string;
    amount_cents: number;
    attachment_key: string | null;
    attachment_content_type: string | null;
  }>(
    `select id, amount_cents, attachment_key, attachment_content_type from expenses
      where description = $1`,
    [description],
  );
  expect(expense?.amount_cents).toBe(45000);
  expect(expense?.attachment_key).not.toBeNull();
  expect(expense?.attachment_content_type).toBe('application/pdf');
  const attachment = await page.request.get(
    `/api/admin/finance/expenses/${expense?.id ?? ''}/attachment`,
    { maxRedirects: 0 },
  );
  expect(attachment.status()).toBe(302);
  expect(attachment.headers()['location']).toContain(
    `/expense-attachments/${expense?.attachment_key ?? ''}`,
  );

  // DRE export: the workbook has the 7 lines and the expense under "Energia".
  await page.getByRole('tab', { name: 'Visão geral' }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Exportar DRE (.xlsx)' }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(
    /^dre-cash-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.xlsx$/,
  );
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(await download.path());
  const sheet = workbook.getWorksheet('DRE');
  if (sheet === undefined) throw new Error('the workbook has no DRE sheet');
  const rows: { label: string; total: unknown }[] = [];
  sheet.eachRow((row) => {
    rows.push({ label: row.getCell(1).text, total: row.getCell(row.cellCount).value });
  });
  expect(rows.map((r) => r.label).filter((label) => /^[1-7]\. /.test(label))).toEqual([
    '1. Receita bruta',
    '2. (−) Descontos, cupons e créditos concedidos',
    '3. (−) Estornos e reembolsos',
    '4. (−) Taxas do gateway de pagamento',
    '5. = Receita líquida',
    '6. (−) Despesas operacionais',
    '7. = Resultado do período',
  ]);
  expect(rows.find((r) => r.label === 'Energia')?.total).toBe(-450);
  expect(rows.find((r) => r.label === '6. (−) Despesas operacionais')?.total).toBe(-450);

  // Clinic calendar link: a VCALENDAR with the clinic's bookings.
  await page.goto('/admin/integracoes');
  await page.getByRole('tab', { name: 'Calendário' }).click();
  const clinic = page.getByRole('region', { name: 'Agenda da clínica' });
  await clinic.getByRole('button', { name: 'Gerar link' }).click();
  const feedUrl = await clinic.getByLabel('Link do calendário').inputValue();
  expect(feedUrl).toMatch(/\/api\/ics\/[A-Za-z0-9_-]+\.ics$/);
  const feed = await request.get(new URL(feedUrl).pathname);
  expect(feed.status()).toBe(200);
  expect(feed.headers()['content-type']).toContain('text/calendar');
  const calendar = parseIcs(await feed.text());
  expect(calendar.props).toMatchObject({
    VERSION: '2.0',
    PRODID: '-//Bravo Clinic//Salas Inteligentes//PT-BR',
  });
  // The load bookings of the harness (user "Carga E2E", Sala Principal) are in the window.
  expect(calendar.events.some((e) => e['SUMMARY'] === 'Carga · Sala Principal')).toBe(true);

  // MCP: turn the server on, issue a read token, list the tools over HTTP, revoke it.
  await page.getByRole('tab', { name: 'MCP' }).click();
  const serverSwitch = page.getByLabel('Servidor MCP ativo');
  // Controlled by the saved setting: it shows checked once the PUT is under way, so click and wait.
  await serverSwitch.click();
  await expect(serverSwitch).toBeChecked();
  const mcpPath = new URL(await page.getByLabel('URL do servidor MCP').inputValue()).pathname;
  expect(mcpPath).toBe('/api/mcp');
  await page.getByRole('button', { name: 'Novo token' }).click();
  const issue = page.getByRole('dialog', { name: 'Novo token de acesso' });
  const tokenName = `E2E ${tag}`;
  await issue.getByLabel('Nome').fill(tokenName);
  await issue.getByRole('button', { name: 'Criar token' }).click();
  const token = await issue.getByLabel('Token de acesso').inputValue();
  expect(token).not.toBe('');
  await issue.getByRole('button', { name: 'Concluir' }).click();

  const initialize = await mcpCall(request, mcpPath, token, 'initialize');
  expect(initialize.status()).toBe(200);
  const list = await mcpCall(request, mcpPath, token, 'tools/list');
  expect(list.status()).toBe(200);
  const listed = (await list.json()) as {
    result: { tools: { name: string; annotations: { readOnlyHint: boolean } }[] };
  };
  const names = listed.result.tools.map((t) => t.name);
  expect(names).toEqual(expect.arrayContaining(['agenda_list', 'finance_dre']));
  // A read token sees read tools only (GES-57).
  expect(names).not.toContain('booking_create');
  expect(listed.result.tools.every((t) => t.annotations.readOnlyHint)).toBe(true);

  await page.getByRole('button', { name: `Revogar token ${tokenName}` }).click();
  await page
    .getByRole('dialog', { name: 'Revogar token' })
    .getByRole('button', { name: 'Revogar token' })
    .click();
  await expect(page.getByText('Token revogado.')).toBeVisible();
  const revoked = await mcpCall(request, mcpPath, token, 'tools/list');
  expect(revoked.status()).toBe(401);
});
