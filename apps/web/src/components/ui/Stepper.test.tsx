import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Stepper } from './Stepper';

const STEPS = ['Sala e data', 'Horário', 'Resumo', 'Pagamento'];

describe('Stepper', () => {
  it('renders the four labelled steps in order inside a named navigation', () => {
    render(<Stepper steps={STEPS} current={0} label="Etapas da reserva" />);

    const nav = screen.getByRole('navigation', { name: 'Etapas da reserva' });
    const items = within(nav).getAllByRole('listitem');
    expect(items).toHaveLength(4);
    expect(items.map((item) => item.textContent)).toEqual([
      '1Sala e data',
      '2Horário',
      '3Resumo',
      '4Pagamento',
    ]);
  });

  it('marks only the active step with aria-current="step"', () => {
    render(<Stepper steps={STEPS} current={2} />);

    const current = screen.getAllByRole('listitem', { current: 'step' });
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent('Resumo');
  });

  it('shows completed steps with a check and a screen-reader note instead of a number', () => {
    render(<Stepper steps={STEPS} current={2} />);

    const [first, second, third] = screen.getAllByRole('listitem');
    expect(first).toHaveTextContent('Sala e data');
    expect(first).toHaveTextContent('(concluída)');
    expect(second).toHaveTextContent('(concluída)');
    expect(first).not.toHaveTextContent('1');
    expect(third).not.toHaveTextContent('(concluída)');
    expect(third).toHaveTextContent('3');
  });
});
