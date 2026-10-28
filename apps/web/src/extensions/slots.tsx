import { Fragment, lazy, Suspense, type ComponentType } from 'react';

// Web extension points of núcleo (design.md section "Web", AD-033). `receita` and `gestao` fill
// these slots from their own modules; every slot renders nothing until a component is registered.

export const SLOT_NAMES = [
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
] as const;

export type SlotName = (typeof SLOT_NAMES)[number];

// Slot components receive page-specific props, so the registry is intentionally loosely typed.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SlotComponent = ComponentType<any>;
export type SlotEntry = SlotComponent | SlotComponent[] | null;

/**
 * A slot component whose module loads the first time the slot renders (GES-143): registration
 * at startup then pulls none of its code (nor zod schemas) into the public entry chunk.
 */
const lazySlotLoaders: (() => Promise<SlotComponent>)[] = [];

/** Loads every lazy slot body now (tests warm them so module loading stays out of their waits). */
export function preloadLazySlots(): Promise<unknown> {
  return Promise.all(lazySlotLoaders.map((load) => load()));
}

export function lazySlot(load: () => Promise<SlotComponent>): SlotComponent {
  lazySlotLoaders.push(load);
  const Body = lazy(async () => ({ default: await load() }));
  return function LazySlot(props: Record<string, unknown>) {
    return (
      <Suspense fallback={null}>
        <Body {...props} />
      </Suspense>
    );
  };
}

function emptySlots(): Record<SlotName, SlotEntry> {
  return Object.fromEntries(SLOT_NAMES.map((name) => [name, null])) as Record<SlotName, SlotEntry>;
}

/** The slot registry; `registerSlot` adds to it and `resetSlots` empties it (tests). */
export const slots: Record<SlotName, SlotEntry> = emptySlots();

/** Adds a component to a slot; several components render in registration order. */
export function registerSlot(name: SlotName, component: SlotComponent): void {
  const current = slots[name];
  if (current === null) slots[name] = component;
  else slots[name] = [...(Array.isArray(current) ? current : [current]), component];
}

export function resetSlots(): void {
  Object.assign(slots, emptySlots());
}

/** The components registered for a slot, in registration order. */
export function slotComponents(name: SlotName): SlotComponent[] {
  const entry = slots[name];
  if (entry === null) return [];
  return Array.isArray(entry) ? entry : [entry];
}

/** Renders the components registered for `name` with `props`, or nothing. */
export function Slot({ name, props }: { name: SlotName; props?: Record<string, unknown> }) {
  const entry = slots[name];
  if (entry === null) return null;
  const components = Array.isArray(entry) ? entry : [entry];
  return (
    <>
      {components.map((Component, index) => (
        <Fragment key={index}>
          <Component {...props} />
        </Fragment>
      ))}
    </>
  );
}
