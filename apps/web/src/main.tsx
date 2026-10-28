import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { ToastProvider } from './components/ui/Toast';
import { registerGestaoSlots } from './extensions/gestao';
import { registerRevenueSlots } from './extensions/receita';
import { initAnalytics } from './lib/analytics';
import { queryClient } from './lib/query-client';
import { PwaUpdatePrompt } from './pwa/PwaUpdatePrompt';
import { createAppRouter } from './router';
import './styles/index.css';
import { ThemeProvider } from './theme/ThemeProvider';

// index.html attaches the Google Fonts stylesheet as `print` so it cannot block this script
// (GES-143); apply it before the first render. The CSP forbids an inline `onload` for this.
document.querySelector('link[data-brand-fonts]')?.setAttribute('media', 'all');

registerRevenueSlots();
registerGestaoSlots();
initAnalytics();

const container = document.getElementById('root');
if (!container) throw new Error('Elemento #root não encontrado.');

createRoot(container).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <RouterProvider router={createAppRouter()} />
          <PwaUpdatePrompt />
        </ToastProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
