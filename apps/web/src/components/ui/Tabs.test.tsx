import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Tabs } from './Tabs';

const items = [
  { id: 'a', label: 'Dados', content: 'Painel dados' },
  { id: 'b', label: 'Segurança', content: 'Painel segurança' },
  { id: 'c', label: 'Consentimentos', content: 'Painel consentimentos' },
];

describe('Tabs', () => {
  it('exposes tablist, tab and tabpanel roles wired by aria attributes', () => {
    render(<Tabs label="Perfil" items={items} />);
    expect(screen.getByRole('tablist', { name: 'Perfil' })).toBeInTheDocument();

    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(3);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false');

    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveTextContent('Painel dados');
    expect(tabs[0]).toHaveAttribute('aria-controls', panel.id);
    expect(panel).toHaveAttribute('aria-labelledby', tabs[0]?.id);
  });

  it('shows only the selected panel and raises the selected tab as a pearl pill on a sunken track', () => {
    render(<Tabs label="Perfil" items={items} defaultValue="b" />);
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Painel segurança');
    expect(screen.getByText('Painel dados')).not.toBeVisible();
    expect(screen.getByRole('tablist')).toHaveClass(
      'rounded-pill',
      'bg-surface-deboss',
      'shadow-deboss',
    );
    expect(screen.getByRole('tab', { name: 'Segurança' })).toHaveClass(
      'rounded-pill',
      'bg-surface-raised',
      'font-semibold',
    );
    expect(screen.getByRole('tab', { name: 'Dados' })).not.toHaveClass('bg-surface-raised');
  });

  it('selects the next tab and shows its panel on ArrowRight', async () => {
    render(<Tabs label="Perfil" items={items} />);
    screen.getByRole('tab', { name: 'Dados' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    const second = screen.getByRole('tab', { name: 'Segurança' });
    expect(second).toHaveAttribute('aria-selected', 'true');
    expect(second).toHaveFocus();
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Painel segurança');
  });

  it('wraps from the first tab to the last on ArrowLeft and from the last to the first on ArrowRight', async () => {
    render(<Tabs label="Perfil" items={items} />);
    screen.getByRole('tab', { name: 'Dados' }).focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Consentimentos' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Dados' })).toHaveAttribute('aria-selected', 'true');
  });

  it('jumps to the last tab on End and to the first on Home', async () => {
    render(<Tabs label="Perfil" items={items} />);
    screen.getByRole('tab', { name: 'Dados' }).focus();
    await userEvent.keyboard('{End}');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Painel consentimentos');
    await userEvent.keyboard('{Home}');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Painel dados');
  });

  it('selects a tab on click and keeps only the selected tab in the tab order', async () => {
    render(<Tabs label="Perfil" items={items} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Segurança' }));
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Painel segurança');
    expect(screen.getByRole('tab', { name: 'Segurança' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: 'Dados' })).toHaveAttribute('tabindex', '-1');
  });

  it('works controlled: reports changes and follows the value prop', async () => {
    const onValueChange = vi.fn();
    const { rerender } = render(
      <Tabs label="Perfil" items={items} value="a" onValueChange={onValueChange} />,
    );
    await userEvent.click(screen.getByRole('tab', { name: 'Segurança' }));
    expect(onValueChange).toHaveBeenCalledWith('b');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Painel dados');

    rerender(<Tabs label="Perfil" items={items} value="b" onValueChange={onValueChange} />);
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Painel segurança');
  });

  it('shows the 2px accent focus-visible ring on tabs', () => {
    render(<Tabs label="Perfil" items={items} />);
    expect(screen.getByRole('tab', { name: 'Dados' })).toHaveClass(
      'focus-visible:ring-2',
      'focus-visible:ring-accent',
      'focus-visible:ring-offset-2',
    );
  });
});
