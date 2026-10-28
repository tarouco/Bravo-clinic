import { createElement, lazy, Suspense } from 'react';
import { CouponField } from '../components/revenue/CouponField';
import { CreditsToggle } from '../components/revenue/CreditsToggle';
import { PackagePaymentOption } from '../components/revenue/PackagePaymentOption';
import { PackagesSection } from '../features/purchases/PackagesSection';
import { registerSlot, slotComponents, type SlotComponent, type SlotName } from './slots';

// receita fills núcleo's web slots (design.md "Required from nucleo" table A, AD-031). Each slot
// registration is idempotent so tests and hot reloads can call `registerRevenueSlots()` again.

/** Admin slot bodies load with the admin pages, outside the public entry chunk (GES-143). */
function lazySlot(load: () => Promise<SlotComponent>): SlotComponent {
  const Body = lazy(async () => ({ default: await load() }));
  return function LazySlot(props: Record<string, unknown>) {
    return createElement(Suspense, { fallback: null }, createElement(Body, props));
  };
}

const PackageCategoryForms = lazySlot(() =>
  import('../features/admin-categories/PackageCategoryForms').then((m) => m.PackageCategoryForms),
);
const SlotDiscountAction = lazySlot(() =>
  import('../features/admin-reservas/SlotDiscountSlots').then((m) => m.SlotDiscountAction),
);
const SlotDiscountOverlay = lazySlot(() =>
  import('../features/admin-reservas/SlotDiscountSlots').then((m) => m.SlotDiscountOverlay),
);
// The reservations page reads the tab id and label before the body loads.
const AssinaturasTab = Object.assign(
  lazySlot(() => import('../features/admin-reservas/AssinaturasTab').then((m) => m.AssinaturasTab)),
  { tabId: 'assinaturas', tabLabel: 'Assinaturas' },
);
const SellSubscriptionAction = lazySlot(() =>
  import('../features/admin-reservas/SellSubscriptionDialog').then((m) => m.SellSubscriptionAction),
);

const REGISTRATIONS: readonly (readonly [SlotName, SlotComponent])[] = [
  ['checkout.summary.discount', CouponField],
  ['checkout.summary.credits', CreditsToggle],
  ['checkout.summary.payWith', PackagePaymentOption],
  ['pricing.packages', PackagesSection],
  ['admin.categories.forms', PackageCategoryForms],
  ['admin.calendar.freeSlotActions', SlotDiscountAction],
  ['admin.calendar.overlays', SlotDiscountOverlay],
  ['admin.reservations.tabs', AssinaturasTab],
  ['admin.reservations.headerActions', SellSubscriptionAction],
];

export function registerRevenueSlots(): void {
  for (const [name, component] of REGISTRATIONS) {
    if (!slotComponents(name).includes(component)) registerSlot(name, component);
  }
}
