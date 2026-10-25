import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { policies } from '../../test/fixtures/nucleo';
import { PolicyAcceptance } from './PolicyAcceptance';

function setup(checked = false) {
  const onChange = vi.fn();
  render(
    <PolicyAcceptance
      sections={policies.sections}
      version={policies.version}
      checked={checked}
      onChange={onChange}
    />,
  );
  return onChange;
}

describe('PolicyAcceptance', () => {
  it('renders every policy section title and the policy version', () => {
    setup();

    for (const section of policies.sections) {
      expect(screen.getByRole('heading', { name: section.title })).toBeInTheDocument();
    }
    expect(screen.getByText('Versão da política: 1')).toBeInTheDocument();
  });

  it('starts unchecked and calls onChange(true) when the box is checked', async () => {
    const onChange = setup();
    const box = screen.getByRole('checkbox', { name: 'Li e aceito a política de reserva' });
    expect(box).not.toBeChecked();

    await userEvent.click(box);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('calls onChange(false) only when a checked box is unchecked', async () => {
    const onChange = setup(true);
    const box = screen.getByRole('checkbox', { name: 'Li e aceito a política de reserva' });
    expect(box).toBeChecked();

    await userEvent.click(box);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(false);
  });
});
