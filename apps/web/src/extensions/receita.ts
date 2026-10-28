import { lazySlot, registerSlot, slotComponents, type SlotComponent, type SlotName } from './slots';

// receita fills núcleo's web slots (design.md "Required from nucleo" table A, AD-031). Each slot
// registration is idempotent so tests and hot reloads can call `registerRevenueSlots()` again.
// Every body loads on first render, outside the public entry chunk (GES-143).

const CouponField = lazySlot(() =>
  import('../components/revenue/CouponField').then((m) => m.CouponField),
);
const CreditsToggle = lazySlot(() =>
  import('../components/revenue/CreditsToggle').then((m) => m.CreditsToggle),
);
const PackagePaymentOption = lazySlot(() =>
  import('../components/revenue/PackagePaymentOption').then((m) => m.PackagePaymentOption),
);
const PackagesSection = lazySlot(() =>
  import('../features/purchases/PackagesSection').then((m) => m.PackagesSection),
);
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
