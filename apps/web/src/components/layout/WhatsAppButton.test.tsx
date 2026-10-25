import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WhatsAppButton } from './WhatsAppButton';

const configState = { whatsappE164: '' };

vi.mock('../../features/config/useClinicConfig', () => ({
  useClinicConfig: () => ({ googleEnabled: false, whatsappE164: configState.whatsappE164 }),
}));

beforeEach(() => {
  configState.whatsappE164 = '';
});

describe('WhatsAppButton', () => {
  it('links to https://wa.me/<digits> when the clinic number is configured', () => {
    configState.whatsappE164 = '+5547999990000';
    render(<WhatsAppButton />);
    expect(screen.getByRole('link', { name: /Concierge WhatsApp/ })).toHaveAttribute(
      'href',
      'https://wa.me/5547999990000',
    );
  });

  it('links to https://wa.me/ when the number is empty', () => {
    render(<WhatsAppButton />);
    expect(screen.getByRole('link', { name: /Concierge WhatsApp/ })).toHaveAttribute(
      'href',
      'https://wa.me/',
    );
  });

  it('opens in a new tab with noopener noreferrer and the title text', () => {
    render(<WhatsAppButton />);
    const link = screen.getByRole('link', { name: /Concierge WhatsApp/ });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveAttribute('title', 'Falar no WhatsApp da Bravô Clinic');
  });

  it('is fixed 24px from the bottom-right corner and hides the label below the sm breakpoint', () => {
    render(<WhatsAppButton />);
    const link = screen.getByRole('link', { name: /Concierge WhatsApp/ });
    expect(link.parentElement).toHaveClass('fixed', 'bottom-6', 'right-6');
    expect(screen.getByText('Concierge WhatsApp')).toHaveClass('hidden', 'sm:inline-block');
  });
});
