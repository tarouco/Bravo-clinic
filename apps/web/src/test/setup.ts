import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from './msw/server';

// Role queries over large calendar grids are slow on a loaded machine: wait longer than 1 s.
configure({ asyncUtilTimeout: 5000 });

// Requests with no handler go through untouched (tests that stub `fetch` keep working).
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'bypass' });
});

afterEach(() => {
  cleanup();
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});
