import { formatDateTimeBR, type DreMatrix, type LocalDate, type Regime } from '@bravo/core';
import ExcelJS from 'exceljs';

// DRE spreadsheet (GES-29..GES-34): sheet "DRE" built in memory with exceljs — header rows naming
// the clinic, regime, period and generation time; one column per month plus "Total"; amounts as
// numbers in reais with the BRL format, deductions negative, lines 5 and 7 bold.

export const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const BRL_FORMAT = '"R$" #,##0.00;-"R$" #,##0.00';
export const REGIME_LABEL: Record<Regime, string> = { cash: 'Caixa', accrual: 'Competência' };
/** Row of the column headers; the rows above it are the GES-34 header block. */
export const TABLE_HEADER_ROW = 6;

export interface DreMeta {
  regime: Regime;
  from: LocalDate;
  to: LocalDate;
  generatedAt: Date;
}

const dateBR = (date: LocalDate) => date.split('-').reverse().join('/');

/** `dre-<regime>-<from>-<to>.xlsx` (GES-29). */
export const dreFileName = (meta: Pick<DreMeta, 'regime' | 'from' | 'to'>) =>
  `dre-${meta.regime}-${meta.from}-${meta.to}.xlsx`;

export async function renderDreXlsx(
  matrix: DreMatrix,
  meta: DreMeta,
): Promise<Uint8Array<ArrayBuffer>> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Bravô Clinic';
  workbook.created = meta.generatedAt;
  const sheet = workbook.addWorksheet('DRE', {
    views: [{ state: 'frozen', xSplit: 1, ySplit: TABLE_HEADER_ROW }],
  });

  sheet.getCell('A1').value = 'Bravô Clinic — Demonstração do Resultado do Exercício (DRE)';
  sheet.getCell('A1').font = { bold: true, size: 14 };
  sheet.getCell('A2').value = `Regime: ${REGIME_LABEL[meta.regime]}`;
  sheet.getCell('A3').value = `Período: ${dateBR(meta.from)} a ${dateBR(meta.to)}`;
  sheet.getCell('A4').value = `Gerado em: ${formatDateTimeBR(meta.generatedAt)}`;

  const header = sheet.getRow(TABLE_HEADER_ROW);
  header.values = ['Conta', ...matrix.months.map((m) => m.label), 'Total'];
  header.font = { bold: true };

  matrix.rows.forEach((line, index) => {
    const row = sheet.getRow(TABLE_HEADER_ROW + 1 + index);
    row.values = [line.label, ...[...line.values, line.total].map((cents) => cents / 100)];
    row.getCell(1).alignment = { indent: line.level === 1 ? 2 : 0 };
    for (let column = 2; column <= matrix.months.length + 2; column += 1) {
      row.getCell(column).numFmt = BRL_FORMAT;
    }
    if (line.bold) row.font = { bold: true };
  });

  sheet.getColumn(1).width = 48;
  for (let column = 2; column <= matrix.months.length + 2; column += 1) {
    sheet.getColumn(column).width = 16;
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return Uint8Array.from(buffer as unknown as ArrayLike<number>);
}
