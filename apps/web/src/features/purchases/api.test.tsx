import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/api';
import * as fixtures from './fixtures';
import {
  purchaseKeys,
  useAdjustBalance,
  useApplySlotDiscount,
  useAdminSubscriptions,
  useCancelPreview,
  useCancelSubscription,
  useCoupons,
  useCredits,
  useExtraHours,
  useGrantCredit,
  useLedger,
  useOccurrenceCheck,
  usePackages,
  usePaySubscription,
  usePurchaseExtraHours,
  usePurchaseHistory,
  usePurchaseSubscription,
  useSellSubscription,
  useSubscriptionQuote,
  useSubscriptions,
  useSwitchSubscription,
} from './api';

vi.mock('../../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api')>('../../lib/api');
  return {
    ...actual,
    api: {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
      blob: vi.fn(),
    },
  };
});

const mocked = vi.mocked(api);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, invalidate, wrapper };
}

const invalidatedKeys = (spy: ReturnType<typeof setup>['invalidate']) =>
  spy.mock.calls.map(([filters]) => filters?.queryKey);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('purchases query hooks (paths and keys)', () => {
  it('usePackages reads GET /api/public/packages under ["public","packages"]', async () => {
    mocked.get.mockResolvedValue(fixtures.packageOffers);
    const { client, wrapper } = setup();

    const { result } = renderHook(() => usePackages(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mocked.get).toHaveBeenCalledWith('/api/public/packages');
    expect(client.getQueryData(['public', 'packages'])).toEqual(fixtures.packageOffers);
  });

  it('useOccurrenceCheck sends roomId and baseOn and waits for both', async () => {
    mocked.get.mockResolvedValue(fixtures.occurrenceCheck);
    const { wrapper } = setup();

    const idle = renderHook(() => useOccurrenceCheck('cat-1', { roomId: 'room-1' }), { wrapper });
    expect(idle.result.current.fetchStatus).toBe('idle');

    const { result } = renderHook(
      () => useOccurrenceCheck('cat-1', { roomId: 'room-1', baseOn: '2026-11-02' }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mocked.get).toHaveBeenCalledWith(
      '/api/public/packages/cat-1/occurrences?roomId=room-1&baseOn=2026-11-02',
    );
  });

  it('useSubscriptions and useCredits use the documented keys', async () => {
    mocked.get.mockImplementation((path: string) =>
      Promise.resolve(
        path.endsWith('/credits') ? fixtures.creditsSummary : fixtures.subscriptionList,
      ),
    );
    const { client, wrapper } = setup();

    const subs = renderHook(() => useSubscriptions(), { wrapper });
    const credits = renderHook(() => useCredits(), { wrapper });

    await waitFor(() => expect(subs.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(credits.result.current.isSuccess).toBe(true));
    expect(mocked.get).toHaveBeenCalledWith('/api/app/subscriptions');
    expect(mocked.get).toHaveBeenCalledWith('/api/app/credits');
    expect(client.getQueryData(['app', 'subscriptions'])).toEqual(fixtures.subscriptionList);
    expect(client.getQueryData(['app', 'credits'])).toEqual(fixtures.creditsSummary);
  });

  it('useExtraHours reads ["app","extra-hours"]', async () => {
    mocked.get.mockResolvedValue(fixtures.extraHoursSummary);
    const { client, wrapper } = setup();

    const { result } = renderHook(() => useExtraHours(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mocked.get).toHaveBeenCalledWith('/api/app/extra-hours');
    expect(client.getQueryData(['app', 'extra-hours'])).toEqual(fixtures.extraHoursSummary);
  });

  it('useLedger paginates by cursor under ["app","subscriptions",id,"ledger"]', async () => {
    mocked.get.mockResolvedValueOnce(fixtures.ledgerPageWithMore);
    mocked.get.mockResolvedValueOnce(fixtures.ledgerPage);
    const { client, wrapper } = setup();

    const { result } = renderHook(() => useLedger('sub-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mocked.get).toHaveBeenLastCalledWith('/api/app/subscriptions/sub-1/ledger');
    expect(result.current.hasNextPage).toBe(true);

    await act(async () => {
      await result.current.fetchNextPage();
    });
    expect(mocked.get).toHaveBeenLastCalledWith(
      '/api/app/subscriptions/sub-1/ledger?cursor=cursor-2',
    );
    expect(client.getQueryData(['app', 'subscriptions', 'sub-1', 'ledger'])).toBeDefined();
  });

  it('usePurchaseHistory reads ["app","purchases","history"]', async () => {
    mocked.get.mockResolvedValue(fixtures.purchaseHistory);
    const { client, wrapper } = setup();

    const { result } = renderHook(() => usePurchaseHistory(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mocked.get).toHaveBeenCalledWith('/api/app/purchases/history');
    expect(client.getQueryData(['app', 'purchases', 'history'])).toBeDefined();
  });

  it('useSubscriptionQuote posts the request once it is complete', async () => {
    mocked.post.mockResolvedValue(fixtures.subscriptionQuote);
    const { wrapper } = setup();
    const idle = renderHook(() => useSubscriptionQuote(null), { wrapper });
    expect(idle.result.current.fetchStatus).toBe('idle');

    const request = { categoryId: 'cat-1', baseOn: '2026-11-02' } as const;
    const { result } = renderHook(() => useSubscriptionQuote(request), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mocked.post).toHaveBeenCalledWith('/api/app/subscriptions/quote', request);
  });

  it('useCancelPreview reads the preview of one subscription', async () => {
    mocked.get.mockResolvedValue(fixtures.cancelPreview);
    const { wrapper } = setup();

    const { result } = renderHook(() => useCancelPreview('sub-1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mocked.get).toHaveBeenCalledWith('/api/app/subscriptions/sub-1/cancel-preview');
  });

  it('admin hooks use ["admin","coupons"] and ["admin","subscriptions",filters]', async () => {
    mocked.get.mockImplementation((path: string) =>
      Promise.resolve(
        path.includes('coupons') ? fixtures.couponList : fixtures.adminSubscriptionList,
      ),
    );
    const { client, wrapper } = setup();

    const coupons = renderHook(() => useCoupons(), { wrapper });
    const subs = renderHook(() => useAdminSubscriptions({ status: 'active', search: 'Ana' }), {
      wrapper,
    });

    await waitFor(() => expect(coupons.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(subs.result.current.isSuccess).toBe(true));
    expect(mocked.get).toHaveBeenCalledWith('/api/admin/coupons');
    expect(mocked.get).toHaveBeenCalledWith('/api/admin/subscriptions?status=active&search=Ana');
    expect(client.getQueryData(['admin', 'coupons'])).toEqual(fixtures.couponList);
    expect(
      client.getQueryData(['admin', 'subscriptions', { status: 'active', search: 'Ana' }]),
    ).toBeDefined();
  });
});

describe('purchases mutations', () => {
  const purchaseBody = {
    categoryId: 'cat-1',
    baseOn: '2026-11-02',
    paymentMethod: 'pix',
    acceptTerms: true,
    acceptRecurring: true,
  } as const;

  it('usePurchaseSubscription posts with a UUID Idempotency-Key and invalidates subscriptions, credits and history', async () => {
    mocked.post.mockResolvedValue(fixtures.subscriptionPurchaseResult);
    const { invalidate, wrapper } = setup();
    const { result } = renderHook(() => usePurchaseSubscription(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ body: purchaseBody });
    });

    const [path, body, options] = mocked.post.mock.calls[0] as [
      string,
      unknown,
      { idempotencyKey: string },
    ];
    expect(path).toBe('/api/app/subscriptions');
    expect(body).toEqual(purchaseBody);
    expect(options.idempotencyKey).toMatch(UUID);
    const keys = invalidatedKeys(invalidate);
    expect(keys).toContainEqual(purchaseKeys.subscriptions);
    expect(keys).toContainEqual(purchaseKeys.credits);
    expect(keys).toContainEqual(purchaseKeys.history);
  });

  it('reuses the caller key to retry the same call and generates a new one otherwise', async () => {
    mocked.post.mockRejectedValueOnce(new Error('rede'));
    mocked.post.mockResolvedValue(fixtures.subscriptionPurchaseResult);
    const { wrapper } = setup();
    const { result } = renderHook(() => usePurchaseSubscription(), { wrapper });

    const key = '3b1c7a2e-5d4f-4a6b-9c8d-1e2f3a4b5c6d';
    await act(async () => {
      await result.current
        .mutateAsync({ body: purchaseBody, idempotencyKey: key })
        .catch(() => undefined);
    });
    await act(async () => {
      await result.current.mutateAsync({ body: purchaseBody, idempotencyKey: key });
    });
    await act(async () => {
      await result.current.mutateAsync({ body: purchaseBody });
    });

    const keys = mocked.post.mock.calls.map(
      (call) => (call[2] as { idempotencyKey: string }).idempotencyKey,
    );
    expect(keys[0]).toBe(key);
    expect(keys[1]).toBe(key);
    expect(keys[2]).toMatch(UUID);
    expect(keys[2]).not.toBe(key);
  });

  it('useCancelSubscription posts the confirmation and invalidates subscriptions', async () => {
    mocked.post.mockResolvedValue({ subscription: fixtures.subscriptionActive });
    const { invalidate, wrapper } = setup();
    const { result } = renderHook(() => useCancelSubscription('sub-1'), { wrapper });

    await act(async () => {
      await result.current.mutateAsync();
    });

    expect(mocked.post).toHaveBeenCalledWith('/api/app/subscriptions/sub-1/cancel', {
      confirm: true,
    });
    expect(invalidatedKeys(invalidate)).toContainEqual(purchaseKeys.subscriptions);
  });

  it('useSwitchSubscription posts to /switch with an Idempotency-Key and invalidates subscriptions', async () => {
    mocked.post.mockResolvedValue(fixtures.subscriptionPurchaseResult);
    const { invalidate, wrapper } = setup();
    const { result } = renderHook(() => useSwitchSubscription('sub-1'), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ body: { categoryId: 'cat-2', paymentMethod: 'pix' } });
    });

    const [path, , options] = mocked.post.mock.calls[0] as [
      string,
      unknown,
      { idempotencyKey: string },
    ];
    expect(path).toBe('/api/app/subscriptions/sub-1/switch');
    expect(options.idempotencyKey).toMatch(UUID);
    expect(invalidatedKeys(invalidate)).toContainEqual(purchaseKeys.subscriptions);
  });

  it('usePaySubscription and usePurchaseExtraHours send an Idempotency-Key and refresh balances', async () => {
    mocked.post.mockResolvedValue({});
    const { invalidate, wrapper } = setup();
    const pay = renderHook(() => usePaySubscription('sub-1'), { wrapper });
    const extra = renderHook(() => usePurchaseExtraHours(), { wrapper });

    await act(async () => {
      await pay.result.current.mutateAsync({ body: { paymentMethod: 'pix' } });
      await extra.result.current.mutateAsync({ body: { hours: 2, paymentMethod: 'pix' } });
    });

    expect(mocked.post.mock.calls[0]?.[0]).toBe('/api/app/subscriptions/sub-1/pay');
    expect(mocked.post.mock.calls[1]?.[0]).toBe('/api/app/extra-hours');
    for (const call of mocked.post.mock.calls) {
      expect((call[2] as { idempotencyKey: string }).idempotencyKey).toMatch(UUID);
    }
    expect(invalidatedKeys(invalidate)).toContainEqual(purchaseKeys.extraHours);
  });

  it('admin sale and credit grant send an Idempotency-Key; adjust and slot discount do not', async () => {
    mocked.post.mockResolvedValue({});
    const { invalidate, wrapper } = setup();
    const sell = renderHook(() => useSellSubscription(), { wrapper });
    const grant = renderHook(() => useGrantCredit('user-1'), { wrapper });
    const adjust = renderHook(() => useAdjustBalance('sub-1'), { wrapper });
    const slot = renderHook(() => useApplySlotDiscount(), { wrapper });

    await act(async () => {
      await sell.result.current.mutateAsync({
        body: {
          userId: 'user-1',
          categoryId: 'cat-1',
          baseOn: '2026-11-02',
          payment: { mode: 'link' },
        },
      });
      await grant.result.current.mutateAsync({
        body: { amountCents: 5000, justification: 'Cortesia da recepção' },
      });
      await adjust.result.current.mutateAsync({ minutes: 60, justification: 'Erro de lançamento' });
      await slot.result.current.mutateAsync({
        roomIds: ['room-1'],
        date: '2026-10-27',
        startMinute: 840,
        endMinute: 960,
        percent: 10,
      });
    });

    const [sellCall, grantCall, adjustCall, slotCall] = mocked.post.mock.calls;
    expect(sellCall?.[0]).toBe('/api/admin/subscriptions');
    expect((sellCall?.[2] as { idempotencyKey: string }).idempotencyKey).toMatch(UUID);
    expect(grantCall?.[0]).toBe('/api/admin/customers/user-1/credits');
    expect((grantCall?.[2] as { idempotencyKey: string }).idempotencyKey).toMatch(UUID);
    expect(adjustCall?.[0]).toBe('/api/admin/subscriptions/sub-1/adjust-balance');
    expect(adjustCall?.[2]).toBeUndefined();
    expect(slotCall?.[0]).toBe('/api/admin/slot-discounts');
    expect(invalidatedKeys(invalidate)).toContainEqual(purchaseKeys.adminSubscriptionsAll);
    expect(invalidatedKeys(invalidate)).toContainEqual(purchaseKeys.adminSlotDiscountsAll);
  });
});
