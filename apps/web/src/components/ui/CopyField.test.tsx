import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CopyField } from './CopyField';

const URL = 'https://bravo-clinic.netlify.app/api/payments/webhook/mercadopago';

describe('CopyField', () => {
  it('shows the value read-only under its label', () => {
    render(<CopyField label="URL do webhook" value={URL} />);

    const input = screen.getByLabelText('URL do webhook');
    expect(input).toHaveValue(URL);
    expect(input).toHaveAttribute('readonly');
  });

  it('copies the value to the clipboard and confirms with "Copiado"', async () => {
    const user = userEvent.setup();
    render(<CopyField label="URL do webhook" value={URL} />);

    await user.click(screen.getByRole('button', { name: 'Copiar' }));

    expect(await navigator.clipboard.readText()).toBe(URL);
    expect(screen.getByRole('status')).toHaveTextContent('Copiado');
  });

  it('tells the admin to select the text when the clipboard is unavailable', async () => {
    const user = userEvent.setup();
    render(<CopyField label="URL do webhook" value={URL} />);
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValueOnce(new Error('denied'));

    await user.click(screen.getByRole('button', { name: 'Copiar' }));

    expect(await screen.findByText(/Não foi possível copiar/)).toBeInTheDocument();
    expect(screen.getByRole('status')).not.toHaveTextContent('Copiado');
  });
});
