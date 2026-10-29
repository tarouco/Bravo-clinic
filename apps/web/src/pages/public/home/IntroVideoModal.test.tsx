import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { INTRO_VIDEO_SRC, INTRO_VIDEO_STORAGE_KEY, IntroVideoModal } from './IntroVideoModal';

afterEach(() => {
  window.localStorage.clear();
});

describe('IntroVideoModal', () => {
  it('opens on the first visit with the video autoplaying muted, and remembers it', () => {
    render(<IntroVideoModal />);

    const dialog = screen.getByRole('dialog', { name: 'Vídeo de apresentação da Bravô Clinic' });
    const video = dialog.querySelector('video');
    expect(video).toHaveAttribute('src', INTRO_VIDEO_SRC);
    expect(video?.autoplay).toBe(true);
    expect(video?.muted).toBe(true);
    expect(window.localStorage.getItem(INTRO_VIDEO_STORAGE_KEY)).not.toBeNull();
  });

  it('closes on a click anywhere, the video included', async () => {
    render(<IntroVideoModal />);

    await userEvent.click(screen.getByRole('dialog').querySelector('video')!);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes on a click on the scrim', async () => {
    render(<IntroVideoModal />);

    await userEvent.click(screen.getByTestId('intro-video-scrim'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not open again once seen', () => {
    window.localStorage.setItem(INTRO_VIDEO_STORAGE_KEY, '2026-10-29T00:00:00.000Z');
    render(<IntroVideoModal />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
