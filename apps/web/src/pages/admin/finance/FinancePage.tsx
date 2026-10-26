import { usePageTitle } from '../../../lib/usePageTitle';
import { FinanceOverviewPage } from './FinanceOverviewPage';

/** `/admin/financeiro`: the admin's financial view (gestao design "Web: Admin screens"). */
export function FinancePage() {
  usePageTitle('Financeiro');

  return (
    <div className="mx-auto max-w-7xl space-y-space-lg">
      <h1 className="font-heading text-heading-mobile text-ink md:text-heading">Financeiro</h1>
      <FinanceOverviewPage />
    </div>
  );
}
