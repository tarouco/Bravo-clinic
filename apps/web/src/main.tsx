import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { ToastProvider } from './components/ui/Toast';
import { registerRevenueSlots } from './extensions/receita';
import { queryClient } from './lib/query-client';
import { PwaUpdatePrompt } from './pwa/PwaUpdatePrompt';
import { createAppRouter } from './router';
import './styles/index.css';
import { ThemeProvider } from './theme/ThemeProvider';

registerRevenueSlots();

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
