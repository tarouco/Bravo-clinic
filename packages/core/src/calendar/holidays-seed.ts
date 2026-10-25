import type { LocalDate } from '../time';

export type HolidayScope = 'national' | 'state' | 'municipal';

export interface HolidaySeedRow {
  date: LocalDate;
  name: string;
  scope: HolidayScope;
  /** True when the date is not confirmed and must be reviewed by the Administrador geral. */
  needsReview: boolean;
}

/**
 * 2026-2027 holidays loaded by the seed: the 10 national holidays per year, the Santa Catarina
 * state holiday (Data Magna) and the Itajai municipal holidays. Carnaval is a ponto facultativo
 * and is configured manually (PRD 5.2). The 2027 Data Magna date is still "a confirmar".
 */
export const holidaySeed: ReadonlyArray<HolidaySeedRow> = [
  { date: '2026-01-01', name: 'Confraternização Universal', scope: 'national', needsReview: false },
  { date: '2026-04-03', name: 'Paixão de Cristo', scope: 'national', needsReview: false },
  { date: '2026-04-21', name: 'Tiradentes', scope: 'national', needsReview: false },
  { date: '2026-05-01', name: 'Dia do Trabalho', scope: 'national', needsReview: false },
  { date: '2026-06-04', name: 'Corpus Christi', scope: 'municipal', needsReview: false },
  { date: '2026-06-15', name: 'Aniversário de Itajaí', scope: 'municipal', needsReview: false },
  {
    date: '2026-08-16',
    name: 'Dia do Estado de Santa Catarina (Data Magna)',
    scope: 'state',
    needsReview: false,
  },
  { date: '2026-09-07', name: 'Independência do Brasil', scope: 'national', needsReview: false },
  { date: '2026-10-12', name: 'Nossa Senhora Aparecida', scope: 'national', needsReview: false },
  { date: '2026-11-02', name: 'Finados', scope: 'national', needsReview: false },
  { date: '2026-11-15', name: 'Proclamação da República', scope: 'national', needsReview: false },
  {
    date: '2026-11-20',
    name: 'Dia Nacional de Zumbi e da Consciência Negra',
    scope: 'national',
    needsReview: false,
  },
  {
    date: '2026-12-08',
    name: 'Nossa Senhora da Imaculada Conceição (padroeira)',
    scope: 'municipal',
    needsReview: false,
  },
  { date: '2026-12-25', name: 'Natal', scope: 'national', needsReview: false },
  { date: '2027-01-01', name: 'Confraternização Universal', scope: 'national', needsReview: false },
  { date: '2027-03-26', name: 'Paixão de Cristo', scope: 'national', needsReview: false },
  { date: '2027-04-21', name: 'Tiradentes', scope: 'national', needsReview: false },
  { date: '2027-05-01', name: 'Dia do Trabalho', scope: 'national', needsReview: false },
  { date: '2027-05-27', name: 'Corpus Christi', scope: 'municipal', needsReview: false },
  { date: '2027-06-15', name: 'Aniversário de Itajaí', scope: 'municipal', needsReview: false },
  {
    date: '2027-08-15',
    name: 'Dia do Estado de Santa Catarina (Data Magna)',
    scope: 'state',
    needsReview: true,
  },
  { date: '2027-09-07', name: 'Independência do Brasil', scope: 'national', needsReview: false },
  { date: '2027-10-12', name: 'Nossa Senhora Aparecida', scope: 'national', needsReview: false },
  { date: '2027-11-02', name: 'Finados', scope: 'national', needsReview: false },
  { date: '2027-11-15', name: 'Proclamação da República', scope: 'national', needsReview: false },
  {
    date: '2027-11-20',
    name: 'Dia Nacional de Zumbi e da Consciência Negra',
    scope: 'national',
    needsReview: false,
  },
  {
    date: '2027-12-08',
    name: 'Nossa Senhora da Imaculada Conceição (padroeira)',
    scope: 'municipal',
    needsReview: false,
  },
  { date: '2027-12-25', name: 'Natal', scope: 'national', needsReview: false },
];
