import { hydrate, type DehydratedState } from '@tanstack/react-query';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { AppProviders } from './AppProviders';
import { registerGestaoSlots } from './extensions/gestao';
import { registerRevenueSlots } from './extensions/receita';
import { initAnalytics } from './lib/analytics';
import { queryClient } from './lib/query-client';
import { isPrerenderedFor, PRERENDER_STATE_ID } from './prerender/markers';
import { PwaUpdatePrompt } from './pwa/PwaUpdatePrompt';
import { createAppRouter } from './router';
import './styles/index.css';

// index.html attaches the Google Fonts stylesheet as `print` so it cannot block this script
// (GES-143); apply it before the first render. The CSP forbids an inline `onload` for this.
document.querySelector('link[data-brand-fonts]')?.setAttribute('media', 'all');

registerRevenueSlots();
registerGestaoSlots();
initAnalytics();

const container = document.getElementById('root');
if (!container) throw new Error('Elemento #root não encontrado.');

const app = (
  <AppProviders client={queryClient}>
    <RouterProvider router={createAppRouter()} />
    <PwaUpdatePrompt />
  </AppProviders>
);

// Build-time prerendered pages (GES-143) hydrate with the query data they were rendered from.
// Any other markup in #root (a page served for another path) is dropped and rendered afresh.
if (isPrerenderedFor(container, window.location.pathname)) {
  const state = document.getElementById(PRERENDER_STATE_ID)?.textContent;
  if (state) hydrate(queryClient, JSON.parse(state) as DehydratedState);
  hydrateRoot(container, app);
} else {
  container.replaceChildren();
  createRoot(container).render(app);
}
