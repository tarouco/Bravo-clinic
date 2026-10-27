import ExcelJS from 'exceljs';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStaff } from '../../../test/booking-helpers';
import { financeTotals, seedFinanceFacts } from '../../../test/factories/finance';
import { forbiddenFetch, send, testEnv } from '../../../test/http';
import { connectMcp } from '../../../test/mcp-client';
import { requireTestDatabaseUrl } from '../../../test/require-test-db';
import { createApp } from '../../app';
import { createDb, withTransaction } from '../../db/client';
import { runSeed } from '../../db/seed';
import { saveSetting } from '../settings/settings.repo';
import { BRL_FORMAT, TABLE_HEADER_ROW } from './dre-xlsx';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

// 12:00 in São Paulo.
const NOW = new Date('2027-03-10T15:00:00.000Z');

beforeEach(async () => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  await runSeed(db);
});

const buildApp = () => createApp({ db, now: () => NOW, fetch: forbiddenFetch, env: testEnv() });

async function download(cookie: string, query: string) {
  const response = await buildApp().request(`/admin/finance/dre.xlsx?${query}`, {
    headers: { Cookie: cookie },
  });
  const bytes = new Uint8Array(await response.arrayBuffer());
  return { response, bytes };
}

async function sheetOf(bytes: Uint8Array) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes.buffer as ArrayBuffer);
  const sheet = workbook.getWorksheet('DRE');
  if (sheet === undefined) throw new Error('no DRE sheet');
  return sheet;
}

/** Table rows under the header: label, then the month values and the total in cents. */
function table(sheet: ExcelJS.Worksheet, months: number) {
  const rows: { label: string; cents: number[]; bold: boolean; format: string }[] = [];
  for (let r = TABLE_HEADER_ROW + 1; r <= sheet.rowCount; r += 1) {
    const row = sheet.getRow(r);
    const cents: number[] = [];
    for (let c = 2; c <= months + 2; c += 1) {
      const value = row.getCell(c).value;
      if (typeof value !== 'number')
        throw new Error(`row ${String(r)} col ${String(c)} is not a number`);
      cents.push(Math.round(value * 100));
    }
    rows.push({
      label: row.getCell(1).text,
      cents,
      bold: row.getCell(1).font.bold === true,
      format: row.getCell(2).numFmt,
    });
  }
  return rows;
}

const summaryTotals = async (cookie: string, query: string) =>
  (
    (await send(buildApp(), 'GET', `/admin/finance/summary?${query}`, { cookie })).body as {
      totals: ReturnType<typeof financeTotals>;
    }
  ).totals;

describe('GET /admin/finance/dre.xlsx (GES-29..GES-34)', () => {
  it('downloads the sheet with month columns, the 7 lines in order, numeric BRL cells and negative deductions', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const { categoryA, categoryB } = await seedFinanceFacts(db, NOW);

    const { response, bytes } = await download(
      admin.cookie,
      'from=2026-10-01&to=2026-12-31&regime=cash',
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(response.headers.get('Content-Disposition')).toBe(
      'attachment; filename="dre-cash-2026-10-01-2026-12-31.xlsx"',
    );
    const sheet = await sheetOf(bytes);
    expect(sheet.getRow(TABLE_HEADER_ROW).values).toEqual([
      undefined,
      'Conta',
      'out/2026',
      'nov/2026',
      'dez/2026',
      'Total',
    ]);
    const rows = table(sheet, 3);
    expect(rows.map((r) => r.label)).toEqual([
      '1. Receita bruta',
      'Locação avulsa',
      'Assinaturas',
      'Horas extras',
      'Serviços extras',
      'Outras receitas',
      '2. (−) Descontos, cupons e créditos concedidos',
      '3. (−) Estornos e reembolsos',
      '4. (−) Taxas do gateway de pagamento',
      '5. = Receita líquida',
      '6. (−) Despesas operacionais',
      categoryA?.name,
      categoryB?.name,
      '7. = Resultado do período',
    ]);
    const byLabel = new Map(rows.map((r) => [r.label, r]));
    expect(byLabel.get('1. Receita bruta')?.cents).toEqual([616_000, 112_900, 0, 728_900]);
    expect(byLabel.get('2. (−) Descontos, cupons e créditos concedidos')?.cents).toEqual([
      0, -2_000, 0, -2_000,
    ]);
    expect(byLabel.get('3. (−) Estornos e reembolsos')?.cents).toEqual([0, -8_000, 0, -8_000]);
    expect(byLabel.get('4. (−) Taxas do gateway de pagamento')?.cents).toEqual([0, -608, 0, -608]);
    expect(byLabel.get('5. = Receita líquida')?.cents).toEqual([616_000, 102_292, 0, 718_292]);
    expect(byLabel.get('7. = Resultado do período')?.cents).toEqual([
      616_000, 92_292, -3_000, 705_292,
    ]);
    // Lines 5 and 7 hold the sums exactly in every column.
    const line = (label: string) => byLabel.get(label)?.cents ?? [];
    for (let i = 0; i < 4; i += 1) {
      expect(line('5. = Receita líquida')[i]).toBe(
        (line('1. Receita bruta')[i] ?? 0) +
          (line('2. (−) Descontos, cupons e créditos concedidos')[i] ?? 0) +
          (line('3. (−) Estornos e reembolsos')[i] ?? 0) +
          (line('4. (−) Taxas do gateway de pagamento')[i] ?? 0),
      );
      expect(line('7. = Resultado do período')[i]).toBe(
        (line('5. = Receita líquida')[i] ?? 0) + (line('6. (−) Despesas operacionais')[i] ?? 0),
      );
    }
    expect(rows.filter((r) => r.bold).map((r) => r.label)).toEqual([
      '5. = Receita líquida',
      '7. = Resultado do período',
    ]);
    expect(new Set(rows.map((r) => r.format))).toEqual(new Set([BRL_FORMAT]));
  });

  it('has a Total column equal to the summary totals in both regimes', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    await seedFinanceFacts(db, NOW);

    for (const regime of ['cash', 'accrual'] as const) {
      const query = `from=2026-10-01&to=2026-12-31&regime=${regime}`;
      const { bytes } = await download(admin.cookie, query);
      const rows = table(await sheetOf(bytes), 3);
      const total = (label: string) => rows.find((r) => r.label === label)?.cents[3];
      const expected = await summaryTotals(admin.cookie, query);
      expect({
        grossCents: total('1. Receita bruta'),
        discountsCents: total('2. (−) Descontos, cupons e créditos concedidos'),
        refundsCents: total('3. (−) Estornos e reembolsos'),
        feesCents: total('4. (−) Taxas do gateway de pagamento'),
        netCents: total('5. = Receita líquida'),
        expensesCents: total('6. (−) Despesas operacionais'),
        resultCents: total('7. = Resultado do período'),
      }).toEqual(expected);
    }
  });

  it('starts with the clinic, regime, period and local generation time, and clips a mid-month start', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    await seedFinanceFacts(db, NOW);

    const { bytes } = await download(admin.cookie, 'from=2026-11-15&to=2026-12-31&regime=accrual');

    const sheet = await sheetOf(bytes);
    expect(sheet.getCell('A1').value).toBe(
      'Bravô Clinic — Demonstração do Resultado do Exercício (DRE)',
    );
    expect(sheet.getCell('A2').value).toBe('Regime: Competência');
    expect(sheet.getCell('A3').value).toBe('Período: 15/11/2026 a 31/12/2026');
    expect(sheet.getCell('A4').value).toBe('Gerado em: 10/03/2027 12:00');
    expect(sheet.getRow(TABLE_HEADER_ROW).values).toEqual([
      undefined,
      'Conta',
      'nov/2026',
      'dez/2026',
      'Total',
    ]);
    const gross = table(sheet, 2).find((r) => r.label === '1. Receita bruta')?.cents;
    // Nov 15..30 only: period days 15..30 (16 × 20533), extra hours, B2 (Nov 25); no B3 (Nov 10).
    expect(gross).toEqual([
      16 * 20_533 + 40_000 + 30_000,
      42_433,
      16 * 20_533 + 40_000 + 30_000 + 42_433,
    ]);
  });

  it('answers 422 for an invalid range and 403 to reception', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const reception = await createStaff(db, 'reception', NOW);

    const invalid = await send(
      buildApp(),
      'GET',
      '/admin/finance/dre.xlsx?from=2025-01-01&to=2027-06-01',
      {
        cookie: admin.cookie,
      },
    );
    const forbidden = await send(
      buildApp(),
      'GET',
      '/admin/finance/dre.xlsx?from=2027-01-01&to=2027-01-31',
      {
        cookie: reception.cookie,
      },
    );

    expect([invalid.status, invalid.error?.code]).toEqual([422, 'VALIDATION_FAILED']);
    expect([forbidden.status, forbidden.error?.code]).toEqual([403, 'FORBIDDEN']);
  });

  it('finance_dre through MCP returns the matrix as JSON', async () => {
    await withTransaction(db, (tx) => saveSetting(tx, 'mcp.enabled', true, null));
    const admin = await createStaff(db, 'admin', NOW);
    await seedFinanceFacts(db, NOW);
    const { token } = (
      await send(buildApp(), 'POST', '/admin/integrations/mcp/tokens', {
        cookie: admin.cookie,
        body: { name: 'Leitura', scope: 'read' },
      })
    ).body as { token: string };
    const client = await connectMcp(buildApp(), token);

    const result = await client.callTool({
      name: 'finance_dre',
      arguments: { from: '2026-10-01', to: '2026-12-31', regime: 'cash' },
    });
    await client.close();

    const matrix = result.structuredContent as {
      months: { key: string; label: string }[];
      rows: { code: string; total: number }[];
    };
    expect(matrix.months.map((m) => m.label)).toEqual(['out/2026', 'nov/2026', 'dez/2026']);
    expect(matrix.rows.find((r) => r.code === 'result')?.total).toBe(705_292);
  });
});
