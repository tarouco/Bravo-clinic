import { useSyncExternalStore } from 'react';
import type { LocalDate } from '@bravo/core';

/** The range an admin picked on the calendar; the discount dialog opens pre-filled with it. */
export interface SlotDiscountPrefill {
  roomId: string | null;
  date: LocalDate;
  startMinute: number;
  endMinute: number;
}

// The free-slot menu lives in a hover card or a selection modal that closes as soon as the
// pointer leaves, so the dialog cannot be owned by the menu item. A tiny store lets the item ask
// and the always-mounted calendar overlay show the dialog.

let request: SlotDiscountPrefill | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function openSlotDiscountDialog(prefill: SlotDiscountPrefill): void {
  request = prefill;
  emit();
}

export function closeSlotDiscountDialog(): void {
  if (request === null) return;
  request = null;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The pending request to apply a discount, or `null` while the dialog is closed. */
export function useSlotDiscountRequest(): SlotDiscountPrefill | null {
  return useSyncExternalStore(subscribe, () => request);
}
