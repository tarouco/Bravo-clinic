import { ExtrasAddonPicker } from '../features/extras/ExtrasAddonPicker';
import { registerSlot, slotComponents, type SlotComponent, type SlotName } from './slots';

// gestao fills núcleo's web slots (design.md "Required from nucleo/receita" R6, AD-033). Each
// registration is idempotent so tests and hot reloads can call `registerGestaoSlots()` again.

const REGISTRATIONS: readonly (readonly [SlotName, SlotComponent])[] = [
  ['checkout.summary.extras', ExtrasAddonPicker],
];

export function registerGestaoSlots(): void {
  for (const [name, component] of REGISTRATIONS) {
    if (!slotComponents(name).includes(component)) registerSlot(name, component);
  }
}
