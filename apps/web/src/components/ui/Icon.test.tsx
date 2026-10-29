import { render, screen } from '@testing-library/react';
import { MapPin } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { BrandLockup, Eyebrow, EyebrowLockup } from './Brand';
import { Icon } from './Icon';

describe('Icon', () => {
  it('renders a decorative svg with stroke-width 1.7 and aria-hidden when no label is given', () => {
    const { container } = render(<Icon as={MapPin} />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute('stroke-width', '1.7');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).not.toHaveAttribute('role');
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('renders role="img" with the aria-label and no aria-hidden when a label is given', () => {
    render(<Icon as={MapPin} label="Local" />);
    const icon = screen.getByRole('img', { name: 'Local' });
    expect(icon.tagName.toLowerCase()).toBe('svg');
    expect(icon).toHaveAttribute('aria-label', 'Local');
    expect(icon).toHaveAttribute('stroke-width', '1.7');
    expect(icon).not.toHaveAttribute('aria-hidden');
  });

  it('applies the requested size and className', () => {
    const { container } = render(<Icon as={MapPin} size={24} className="text-bronze" />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('width', '24');
    expect(svg).toHaveAttribute('height', '24');
    expect(svg).toHaveClass('text-bronze');
  });
});

describe('BrandLockup', () => {
  it.each(['header', 'footer'] as const)('renders both lines of the %s lockup', (variant) => {
    render(<BrandLockup variant={variant} />);
    expect(screen.getByText('BRAVÔ CLINIC')).toBeInTheDocument();
    expect(screen.getByText('SALAS INTELIGENTES')).toBeInTheDocument();
  });
});

describe('EyebrowLockup', () => {
  it('renders the text between two decorative aria-hidden rules', () => {
    const { container } = render(<EyebrowLockup />);
    const root = container.firstElementChild;
    expect(root?.children).toHaveLength(3);
    const [before, text, after] = Array.from(root?.children ?? []);
    expect(text).toHaveTextContent('SALAS INTELIGENTES');
    expect(text).not.toHaveAttribute('aria-hidden');
    for (const rule of [before, after]) {
      expect(rule).toHaveAttribute('aria-hidden', 'true');
      expect(rule).toHaveClass('bg-hairline');
      expect(rule).toBeEmptyDOMElement();
    }
  });

  it('renders custom text between the rules', () => {
    render(<EyebrowLockup>Preços e planos</EyebrowLockup>);
    expect(screen.getByText('Preços e planos')).toBeInTheDocument();
  });
});

describe('Eyebrow', () => {
  it('renders uppercase bronze eyebrow text with .28em tracking', () => {
    render(<Eyebrow>Arquitetura sensorial</Eyebrow>);
    const eyebrow = screen.getByText('Arquitetura sensorial');
    expect(eyebrow).toHaveClass('uppercase', 'text-bronze', 'tracking-[0.28em]', 'font-eyebrow');
  });
});
