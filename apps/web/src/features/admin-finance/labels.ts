import type { RevenueCategory } from '@bravo/core';

/** Revenue categories of the finance engine in report order (GES-31 sub-rows). */
export const REVENUE_CATEGORY_LABELS: Record<RevenueCategory, string> = {
  rental_single: 'Locação avulsa',
  subscription_initial: 'Assinatura (primeiro pagamento)',
  subscription_renewal: 'Assinatura (renovação)',
  extra_hours: 'Horas extras',
  extra_services: 'Serviços extras',
  other: 'Outras receitas',
};

export const REGIME_LABELS = { cash: 'Caixa', accrual: 'Competência' } as const;

export const GROUPING_LABELS = { week: 'Semana', month: 'Mês', quarter: 'Trimestre' } as const;
