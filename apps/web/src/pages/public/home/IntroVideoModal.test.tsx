import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INTRO_VIDEO_STORAGE_KEY, INTRO_VIDEOS, IntroVideoModal } from './IntroVideoModal';

const fetchMock = vi.fn<typeof fetch>();

/** API answers: `/vsl/turn` returns `turn` (or fails when null), `/vsl/logs` returns 204. */
function answerTurn(turn: number | null) {
  fetchMock.mockImplementation((input) => {
    const url = input as string;
    if (url.endsWith('/vsl/turn')) {
      return Promise.resolve(
        turn === null
          ? new Response('', { status: 503 })
          : new Response(JSON.stringify({ turn }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
      );
    }
    return Promise.resolve(new Response(null, { status: 204 }));
  });
}

function logCalls() {
  return fetchMock.mock.calls
    .filter(([input]) => (input as string).endsWith('/vsl/logs'))
    .map(([, init]) => JSON.parse(init?.body as string) as Record<string, unknown>);
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  window.localStorage.clear();
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

const openDialog = () =>
  screen.findByRole('dialog', { name: 'Vídeo de apresentação da Bravô Clinic' });

describe('IntroVideoModal', () => {
  it('opens on the first visit with the video autoplaying muted, and remembers it', async () => {
    answerTurn(0);
    render(<IntroVideoModal />);

    const video = (await openDialog()).querySelector('video');
    expect(video).toHaveAttribute('src', INTRO_VIDEOS[0]!.src);
    expect(video?.autoplay).toBe(true);
    expect(video?.muted).toBe(true);
    expect(window.localStorage.getItem(INTRO_VIDEO_STORAGE_KEY)).not.toBeNull();
  });

  it('plays the video of the turn the API hands out, alternating between the two', async () => {
    answerTurn(7);
    render(<IntroVideoModal />);

    expect((await openDialog()).querySelector('video')).toHaveAttribute(
      'src',
      INTRO_VIDEOS[1]!.src,
    );
  });

  it('still opens with one of the videos when the API does not answer', async () => {
    answerTurn(null);
    render(<IntroVideoModal />);

    const src = (await openDialog()).querySelector('video')?.getAttribute('src');
    expect(INTRO_VIDEOS.map((v) => v.src)).toContain(src);
  });

  it('closes on a click anywhere and logs the video, the turn and where it was left', async () => {
    answerTurn(4);
    render(<IntroVideoModal />);
    const video = (await openDialog()).querySelector('video')!;
    Object.defineProperty(video, 'currentTime', { value: 9.87654, configurable: true });
    Object.defineProperty(video, 'duration', { value: 17.05, configurable: true });

    await userEvent.click(video);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(logCalls()).toEqual([
      expect.objectContaining({
        video: 'propaganda-instagram-01',
        turn: 4,
        playedSeconds: 9.877,
        durationSeconds: 17.05,
        exit: 'click',
      }),
    ]);
    expect(
      fetchMock.mock.calls.find(([u]) => (u as string).endsWith('/vsl/logs'))?.[1],
    ).toMatchObject({ keepalive: true, method: 'POST' });
  });

  it('logs an Escape and a page exit with their own method, once each visit', async () => {
    answerTurn(1);
    render(<IntroVideoModal />);
    await openDialog();

    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    await userEvent.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(logCalls().map((b) => b['exit'])).toEqual(['pagehide']);
  });

  it('closes on a click on the scrim', async () => {
    answerTurn(0);
    render(<IntroVideoModal />);
    await openDialog();

    await userEvent.click(screen.getByTestId('intro-video-scrim'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(logCalls()).toHaveLength(1);
  });

  it('does not open again once seen, nor take a turn', () => {
    window.localStorage.setItem(INTRO_VIDEO_STORAGE_KEY, '2026-10-29T00:00:00.000Z');
    render(<IntroVideoModal />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
