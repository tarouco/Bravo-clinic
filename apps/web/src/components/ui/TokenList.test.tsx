import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TokenList, type McpTokenView } from './TokenList';

const TOKENS: McpTokenView[] = [
  {
    id: 't1',
    name: 'Assistente da recepção',
    scope: 'read_write',
    prefix: 'bvmcp_ab12',
    createdAt: '2026-10-01T15:00:00.000Z',
    lastUsedAt: '2026-10-20T15:00:00.000Z',
    expiresAt: null,
    revokedAt: null,
  },
  {
    id: 't2',
    name: 'Relatórios',
    scope: 'read',
    prefix: 'bvmcp_cd34',
    createdAt: '2026-09-01T15:00:00.000Z',
    lastUsedAt: null,
    expiresAt: '2027-09-01T15:00:00.000Z',
    revokedAt: '2026-10-10T15:00:00.000Z',
  },
];

describe('TokenList', () => {
  it('lists name, prefix, scope, dates and status without any secret', () => {
    render(<TokenList tokens={TOKENS} onRevoke={vi.fn()} />);

    const rows = screen.getAllByRole('row').slice(1);
    const first = within(rows[0] as HTMLElement).getAllByRole('cell');
    expect(first.slice(0, 7).map((c) => c.textContent)).toEqual([
      'Assistente da recepção',
      'bvmcp_ab12…',
      'Leitura e escrita',
      '01/10/2026',
      '20/10/2026',
      '—',
      'Ativo',
    ]);
    const second = within(rows[1] as HTMLElement).getAllByRole('cell');
    expect(second[2]).toHaveTextContent('Leitura');
    expect(second[6]).toHaveTextContent('Revogado');
  });

  it('offers "Revogar" only for tokens that are not revoked', () => {
    render(<TokenList tokens={TOKENS} onRevoke={vi.fn()} />);

    expect(
      screen.getByRole('button', { name: 'Revogar token Assistente da recepção' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Revogar token Relatórios' }),
    ).not.toBeInTheDocument();
  });

  it('asks for confirmation before revoking and only then calls onRevoke', async () => {
    const onRevoke = vi.fn();
    render(<TokenList tokens={TOKENS} onRevoke={onRevoke} />);

    await userEvent.click(
      screen.getByRole('button', { name: 'Revogar token Assistente da recepção' }),
    );

    const dialog = await screen.findByRole('dialog', { name: 'Revogar token' });
    expect(dialog).toHaveTextContent('Assistente da recepção');
    expect(onRevoke).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Revogar token' }));

    expect(onRevoke).toHaveBeenCalledExactlyOnceWith('t1');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps the token when the admin cancels the dialog', async () => {
    const onRevoke = vi.fn();
    render(<TokenList tokens={TOKENS} onRevoke={onRevoke} />);

    await userEvent.click(
      screen.getByRole('button', { name: 'Revogar token Assistente da recepção' }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Cancelar' }));

    expect(onRevoke).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the empty message', () => {
    render(<TokenList tokens={[]} onRevoke={vi.fn()} />);

    expect(screen.getByText('Nenhum token emitido.')).toBeInTheDocument();
  });
});
