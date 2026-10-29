import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ArchitectureSection } from './ArchitectureSection';

describe('ArchitectureSection', () => {
  it('is the #estrutura section with the reference heading', () => {
    const { container } = render(<ArchitectureSection />);

    expect(container.querySelector('section')).toHaveAttribute('id', 'estrutura');
    expect(
      screen.getByRole('heading', {
        level: 2,
        name: 'A extensão natural da sua autoridade clínica.',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText('Arquitetura hospitalar sensorial')).toBeInTheDocument();
  });

  it('shows the two stats with the corrected opening-hours caption', () => {
    render(<ArchitectureSection />);

    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(screen.getByText('Conformidade e biossegurança RDC Anvisa')).toBeInTheDocument();
    expect(screen.getByText('07h-00h')).toBeInTheDocument();
    expect(screen.getByText('Abertos todos os dias, inclusive feriados')).toBeInTheDocument();
    expect(screen.queryByText(/Amplitude horária/)).not.toBeInTheDocument();
  });

  it('serves local images whose alt text names Praia Brava and never Jardins or Sao Paulo', () => {
    render(<ArchitectureSection />);

    const images = screen.getAllByRole('img');
    expect(images.map((img) => img.getAttribute('src'))).toEqual([
      '/images/recepcao.webp',
      '/images/consultorio.webp',
    ]);
    for (const image of images) {
      expect(image.getAttribute('alt')).toMatch(/Praia Brava, Itajaí/);
      expect(image.getAttribute('alt')).not.toMatch(/Jardins|Sao Paulo|São Paulo/);
    }
  });

  it('renders the two feature cards', () => {
    render(<ArchitectureSection />);

    expect(screen.getByText('Hospitalidade real')).toBeInTheDocument();
    expect(screen.getByText('Acústica de estúdio')).toBeInTheDocument();
  });
});
