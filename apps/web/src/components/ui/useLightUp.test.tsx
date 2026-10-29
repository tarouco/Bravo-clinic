import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cx } from './cx';
import { LIGHT_UP_MS, useLightUp } from './useLightUp';

function Lamp({ disabled = false }: { disabled?: boolean }) {
  const { litClass, lightUp } = useLightUp(disabled);
  return (
    <button type="button" className={cx('bv-btn', litClass)} onClick={lightUp}>
      Acender
    </button>
  );
}

const lamp = () => screen.getByRole('button', { name: 'Acender' });

describe('useLightUp', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts unlit, so prerendered markup does not depend on interaction', () => {
    render(<Lamp />);
    expect(lamp()).not.toHaveClass('is-lit');
  });

  it('adds is-lit on click and removes it after 1600 ms', () => {
    render(<Lamp />);
    fireEvent.click(lamp());
    expect(lamp()).toHaveClass('is-lit');

    act(() => {
      vi.advanceTimersByTime(LIGHT_UP_MS - 1);
    });
    expect(lamp()).toHaveClass('is-lit');

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(lamp()).not.toHaveClass('is-lit');
    expect(LIGHT_UP_MS).toBe(1600);
  });

  it('restarts the 1.6 s when clicked again while lit', () => {
    render(<Lamp />);
    fireEvent.click(lamp());
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    fireEvent.click(lamp());
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(lamp()).toHaveClass('is-lit');
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(lamp()).not.toHaveClass('is-lit');
  });

  it('never lights while disabled', () => {
    render(<Lamp disabled />);
    fireEvent.click(lamp());
    expect(lamp()).not.toHaveClass('is-lit');
  });

  it('clears its timer on unmount', () => {
    const { unmount } = render(<Lamp />);
    fireEvent.click(lamp());
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
