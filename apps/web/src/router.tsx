import { createBrowserRouter, type RouteObject } from 'react-router-dom';
import { PublicLayout } from './components/layout/PublicLayout';
import { HomePage } from './pages/public/home/HomePage';
import { NotFoundPage } from './pages/public/NotFoundPage';

/** Minimal route table: Home and the 404 page inside the public layout. The full table lands with the guards. */
export const appRoutes: RouteObject[] = [
  {
    element: <PublicLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

export const createAppRouter = () => createBrowserRouter(appRoutes);
