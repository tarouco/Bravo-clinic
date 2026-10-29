import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HeroSection } from './HeroSection';

describe('HeroSection', () => {
  it('renders the h1 and the short lead', () => {
    render(<HeroSection />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Saúde, beleza e bem-estar em um só lugar.' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/estúdios clínicos na Praia Brava, em Itajaí/)).toBeInTheDocument();
  });

  it('links the primary CTA to #simulador and the secondary link to #salas', () => {
    render(<HeroSection />);

    expect(screen.getByRole('link', { name: /Simular e reservar/ })).toHaveAttribute(
      'href',
      '#simulador',
    );
    expect(screen.getByRole('link', { name: 'Conhecer as salas' })).toHaveAttribute(
      'href',
      '#salas',
    );
  });

  it('shows the flagship room photo and the mobile tour loop', () => {
    const { container } = render(<HeroSection />);

    expect(screen.getByRole('img', { name: /Sala Principal da Bravô Clinic/ })).toHaveAttribute(
      'src',
      '/images/sala-principal.webp',
    );
    const video = container.querySelector('video');
    expect(video).toHaveAttribute('poster', '/images/tour-poster.webp');
    expect(video?.muted).toBe(true);
  });

  it('turns the long lead into three highlights and no booking form', () => {
    render(<HeroSection />);

    expect(screen.getByText('Por hora, meio turno ou turno')).toBeInTheDocument();
    expect(screen.getByText('Sem taxa de adesão')).toBeInTheDocument();
    expect(screen.getByText('Sem condomínio ou burocracia fixa')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });
});
