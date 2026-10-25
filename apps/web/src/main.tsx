import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/index.css';

const container = document.getElementById('root');
if (!container) throw new Error('Elemento #root não encontrado.');

createRoot(container).render(
  <StrictMode>
    <main>Bravô Clinic</main>
  </StrictMode>,
);
