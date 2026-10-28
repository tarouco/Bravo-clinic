import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { StrictMode, type ReactNode } from 'react';
import { ToastProvider } from './components/ui/Toast';
import { ThemeProvider } from './theme/ThemeProvider';

/**
 * The providers around the router, shared by the browser entry and the build-time prerender
 * (GES-143) so both render the same markup.
 */
export function AppProviders({ client, children }: { client: QueryClient; children: ReactNode }) {
  return (
    <StrictMode>
      <ThemeProvider>
        <QueryClientProvider client={client}>
          <ToastProvider>{children}</ToastProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </StrictMode>
  );
}
