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
  it('sets the name in type: Bravô in display 300 with wide tracking, then Clinic', () => {
    render(<BrandLockup variant="header" />);
    expect(screen.getByText('Bravô')).toHaveClass(
      'font-display',
      'font-light',
      'uppercase',
      'tracking-[0.16em]',
    );
    expect(screen.getByText('Clinic')).toHaveClass('uppercase');
    expect(screen.queryByText('Salas inteligentes')).not.toBeInTheDocument();
  });

  it('adds the "Salas inteligentes" tagline between rules in the footer and on request', () => {
    const { unmount } = render(<BrandLockup variant="footer" />);
    expect(screen.getByText('Bravô')).toHaveClass('text-on-emerald');
    expect(screen.getByText('Salas inteligentes')).toHaveClass('text-gold');
    unmount();

    render(<BrandLockup tagline />);
    expect(screen.getByText('Salas inteligentes')).toHaveClass('uppercase', 'text-ink-muted');
  });
});

describe('EyebrowLockup', () => {
  it('renders the text between two decorative aria-hidden rules', () => {
    const { container } = render(<EyebrowLockup />);
    const root = container.firstElementChild;
    expect(root?.children).toHaveLength(3);
    const [before, text, after] = Array.from(root?.children ?? []);
    expect(text).toHaveTextContent('Salas inteligentes');
    expect(text).toHaveClass('uppercase', 'text-eyebrow');
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
  it('renders uppercase eyebrow text in the accent color (.32em tracking from text-eyebrow)', () => {
    render(<Eyebrow>Arquitetura sensorial</Eyebrow>);
    const eyebrow = screen.getByText('Arquitetura sensorial');
    expect(eyebrow).toHaveClass('uppercase', 'text-accent', 'text-eyebrow', 'font-eyebrow');
  });
});
