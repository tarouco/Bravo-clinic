import { setupServer } from 'msw/node';
import { handlers } from './handlers';

/** Node request interceptor shared by all web tests (started in `src/test/setup.ts`). */
export const server = setupServer(...handlers);
