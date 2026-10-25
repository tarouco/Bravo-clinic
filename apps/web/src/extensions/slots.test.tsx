import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { registerSlot, resetSlots, Slot, SLOT_NAMES, slots } from './slots';

afterEach(() => {
  resetSlots();
});

describe('Slot registry (NUC-203)', () => {
  it('defines exactly the 11 slot names of the spec', () => {
    expect([...SLOT_NAMES]).toEqual([
      'pricing.packages',
      'checkout.summary.discount',
      'checkout.summary.credits',
      'checkout.summary.payWith',
      'checkout.summary.extras',
      'booking.detail.extra',
      'admin.calendar.freeSlotActions',
      'admin.calendar.overlays',
      'admin.categories.forms',
      'admin.reservations.tabs',
      'admin.reservations.headerActions',
    ]);
    expect(Object.keys(slots).sort()).toEqual([...SLOT_NAMES].sort());
  });

  it.each(SLOT_NAMES)('%s renders nothing by default', (name) => {
    const { container } = render(<Slot name={name} />);

    expect(container).toBeEmptyDOMElement();
  });

  it.each(SLOT_NAMES)('%s renders a registered component with the given props', (name) => {
    registerSlot(name, ({ label }: { label: string }) => <p>fake {label}</p>);

    render(<Slot name={name} props={{ label: name }} />);

    expect(screen.getByText(`fake ${name}`)).toBeInTheDocument();
  });

  it('renders several registered components in registration order', () => {
    registerSlot('pricing.packages', () => <p>first</p>);
    registerSlot('pricing.packages', () => <p>second</p>);

    const { container } = render(<Slot name="pricing.packages" />);

    expect(Array.from(container.querySelectorAll('p')).map((p) => p.textContent)).toEqual([
      'first',
      'second',
    ]);
  });
});
