import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import type {
  AdminCancelInput,
  AdminSaleInput,
  BalanceAdjustInput,
  CouponInput,
  ExtraHoursPurchaseInput,
  ManualCreditInput,
  PayInput,
  SlotDiscountInput,
  SubscriptionPurchaseInput,
  SubscriptionQuoteInput,
  SwitchInput,
  SwitchQuoteInput,
} from '@bravo/core';
import { api } from '../../lib/api';
import { newIdempotencyKey, withQuery } from '../../lib/query-string';
import { availabilityKeys } from '../availability/api';
import { calendarKeys } from '../calendar/api';
import type { IdempotentVariables } from '../booking/api';
import type {
  AdjustBalanceResult,
  AdminSubscriptionRow,
  CancelPreview,
  Coupon,
  CouponUse,
  CreditsSummary,
  ExtraHoursPurchaseResult,
  ExtraHoursSummary,
  GrantCreditResult,
  LedgerPage,
  OccurrenceCheck,
  PackageOffer,
  PurchaseHistoryItem,
  SlotDiscount,
  SlotDiscountApplyResult,
  Subscription,
  SubscriptionPurchaseResult,
  SubscriptionQuote,
  SwitchQuote,
} from './types';

// Receita data layer (design.md "API Contracts"): one hook per endpoint with the documented query
// keys. Money-moving mutations take `{ body, idempotencyKey? }`: the caller reuses the key only to
// retry the same attempt, otherwise a new UUID is generated for the call.

export type { IdempotentVariables } from '../booking/api';

export interface AdminSubscriptionFilters {
  status?: string;
  type?: string;
  search?: string;
}

export interface SlotDiscountRange {
  from: string;
  to: string;
  roomId?: string;
}

interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export const purchaseKeys = {
  packages: ['public', 'packages'] as const,
  occurrences: (categoryId: string, roomId: string | undefined, baseOn: string | undefined) =>
    ['public', 'packages', categoryId, 'occurrences', roomId ?? null, baseOn ?? null] as const,
  subscriptions: ['app', 'subscriptions'] as const,
  subscriptionQuote: (request: SubscriptionQuoteInput | null) =>
    ['app', 'subscriptions', 'quote', request] as const,
  subscription: (id: string) => ['app', 'subscriptions', id] as const,
  ledger: (id: string) => ['app', 'subscriptions', id, 'ledger'] as const,
  switchQuote: (id: string, request: SwitchQuoteInput | null) =>
    ['app', 'subscriptions', id, 'switch-quote', request] as const,
  cancelPreview: (id: string) => ['app', 'subscriptions', id, 'cancel-preview'] as const,
  extraHours: ['app', 'extra-hours'] as const,
  credits: ['app', 'credits'] as const,
  history: ['app', 'purchases', 'history'] as const,
  adminCoupons: ['admin', 'coupons'] as const,
  adminCouponUses: (id: string) => ['admin', 'coupons', id, 'uses'] as const,
  adminSubscriptionsAll: ['admin', 'subscriptions'] as const,
  adminSubscriptions: (filters: AdminSubscriptionFilters) =>
    ['admin', 'subscriptions', filters] as const,
  adminSubscription: (id: string) => ['admin', 'subscription', id] as const,
  adminLedger: (id: string) => ['admin', 'subscription', id, 'ledger'] as const,
  adminSlotDiscountsAll: ['admin', 'slot-discounts'] as const,
  adminSlotDiscounts: (range: SlotDiscountRange) => ['admin', 'slot-discounts', range] as const,
  adminCustomerCredits: (userId: string) => ['admin', 'customers', userId, 'credits'] as const,
};

const keyOf = (v: { idempotencyKey?: string }): string => v.idempotencyKey ?? newIdempotencyKey();

/** Cursor pagination shared by the "Carregar mais" lists. */
function infiniteOptions<T extends Page<unknown>>(
  queryKey: readonly unknown[],
  path: string,
  params: Record<string, string | number | boolean | null | undefined> = {},
  enabled = true,
) {
  return {
    queryKey,
    enabled,
    initialPageParam: null as string | null,
    getNextPageParam: (last: T) => last.nextCursor,
    queryFn: ({ pageParam }: { pageParam: string | null }) =>
      api.get<T>(withQuery(path, { ...params, cursor: pageParam })),
  };
}

// ---- Public ----

/** Active public package offers (`/precos`, `/assinar`). */
export function usePackages() {
  return useQuery<{ items: PackageOffer[] }>({
    queryKey: purchaseKeys.packages,
    staleTime: 60 * 1000,
    queryFn: () => api.get('/api/public/packages'),
  });
}

/** Occurrences, conflicts and suggestions of a fixed schedule for a room and start date. */
export function useOccurrenceCheck(
  categoryId: string | undefined,
  params: { roomId?: string; baseOn?: string },
) {
  const enabled = Boolean(categoryId) && Boolean(params.roomId) && Boolean(params.baseOn);
  return useQuery<OccurrenceCheck>({
    queryKey: purchaseKeys.occurrences(categoryId ?? '', params.roomId, params.baseOn),
    enabled,
    staleTime: 15 * 1000,
    placeholderData: keepPreviousData,
    queryFn: () =>
      api.get(
        withQuery(`/api/public/packages/${encodeURIComponent(categoryId ?? '')}/occurrences`, {
          roomId: params.roomId,
          baseOn: params.baseOn,
        }),
      ),
  });
}

// ---- Tenant: subscriptions ----

/** Purchases change subscriptions, credits, history and what the public grid offers. */
function invalidateMoney(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: purchaseKeys.subscriptions });
  void queryClient.invalidateQueries({ queryKey: purchaseKeys.extraHours });
  void queryClient.invalidateQueries({ queryKey: purchaseKeys.credits });
  void queryClient.invalidateQueries({ queryKey: purchaseKeys.history });
  void queryClient.invalidateQueries({ queryKey: availabilityKeys.all });
}

export function useSubscriptions() {
  return useQuery<{ items: Subscription[] }>({
    queryKey: purchaseKeys.subscriptions,
    queryFn: () => api.get('/api/app/subscriptions'),
  });
}

/** One subscription; `poll` re-reads it every 2 s (waiting for a payment to be confirmed). */
export function useSubscription(id: string | undefined, options: { poll?: boolean } = {}) {
  return useQuery<Subscription>({
    queryKey: purchaseKeys.subscription(id ?? ''),
    enabled: Boolean(id),
    refetchInterval: options.poll ? 2000 : false,
    queryFn: () => api.get(`/api/app/subscriptions/${id ?? ''}`),
  });
}

/** Price, period dates and coupon/credit effect of a purchase; `null` until the form is complete. */
export function useSubscriptionQuote(request: SubscriptionQuoteInput | null) {
  return useQuery<SubscriptionQuote>({
    queryKey: purchaseKeys.subscriptionQuote(request),
    enabled: request !== null,
    placeholderData: keepPreviousData,
    queryFn: () => api.post('/api/app/subscriptions/quote', request),
  });
}

export function usePurchaseSubscription() {
  const queryClient = useQueryClient();
  return useMutation<
    SubscriptionPurchaseResult,
    Error,
    IdempotentVariables<SubscriptionPurchaseInput>
  >({
    mutationFn: (v) => api.post('/api/app/subscriptions', v.body, { idempotencyKey: keyOf(v) }),
    onSuccess: () => invalidateMoney(queryClient),
  });
}

/** Extrato of a subscription, newest first, cursor-paginated. */
export function useLedger(subscriptionId: string | undefined) {
  return useInfiniteQuery<
    LedgerPage,
    Error,
    { pages: LedgerPage[] },
    readonly unknown[],
    string | null
  >(
    infiniteOptions<LedgerPage>(
      purchaseKeys.ledger(subscriptionId ?? ''),
      `/api/app/subscriptions/${subscriptionId ?? ''}/ledger`,
      {},
      Boolean(subscriptionId),
    ),
  );
}

export function useSwitchQuote(subscriptionId: string, request: SwitchQuoteInput | null) {
  return useQuery<SwitchQuote>({
    queryKey: purchaseKeys.switchQuote(subscriptionId, request),
    enabled: request !== null,
    queryFn: () => api.post(`/api/app/subscriptions/${subscriptionId}/switch/quote`, request),
  });
}

export function useSwitchSubscription(subscriptionId: string) {
  const queryClient = useQueryClient();
  return useMutation<SubscriptionPurchaseResult, Error, IdempotentVariables<SwitchInput>>({
    mutationFn: (v) =>
      api.post(`/api/app/subscriptions/${subscriptionId}/switch`, v.body, {
        idempotencyKey: keyOf(v),
      }),
    onSuccess: () => invalidateMoney(queryClient),
  });
}

export function useCancelPreview(subscriptionId: string, enabled = true) {
  return useQuery<CancelPreview>({
    queryKey: purchaseKeys.cancelPreview(subscriptionId),
    enabled,
    queryFn: () => api.get(`/api/app/subscriptions/${subscriptionId}/cancel-preview`),
  });
}

export function useCancelSubscription(subscriptionId: string) {
  const queryClient = useQueryClient();
  return useMutation<{ subscription: Subscription }, Error, void>({
    mutationFn: () =>
      api.post(`/api/app/subscriptions/${subscriptionId}/cancel`, { confirm: true }),
    onSuccess: () => invalidateMoney(queryClient),
  });
}

/** Pays an awaiting subscription or regularizes a suspended one. */
export function usePaySubscription(subscriptionId: string) {
  const queryClient = useQueryClient();
  return useMutation<
    { charge: SubscriptionPurchaseResult['charge']; subscription: Subscription },
    Error,
    IdempotentVariables<PayInput>
  >({
    mutationFn: (v) =>
      api.post(`/api/app/subscriptions/${subscriptionId}/pay`, v.body, {
        idempotencyKey: keyOf(v),
      }),
    onSuccess: () => invalidateMoney(queryClient),
  });
}

// ---- Tenant: extra hours, credits, history ----

export function useExtraHours() {
  return useQuery<ExtraHoursSummary>({
    queryKey: purchaseKeys.extraHours,
    queryFn: () => api.get('/api/app/extra-hours'),
  });
}

export function usePurchaseExtraHours() {
  const queryClient = useQueryClient();
  return useMutation<ExtraHoursPurchaseResult, Error, IdempotentVariables<ExtraHoursPurchaseInput>>(
    {
      mutationFn: (v) => api.post('/api/app/extra-hours', v.body, { idempotencyKey: keyOf(v) }),
      onSuccess: () => invalidateMoney(queryClient),
    },
  );
}

export function useCredits() {
  return useQuery<CreditsSummary>({
    queryKey: purchaseKeys.credits,
    queryFn: () => api.get('/api/app/credits'),
  });
}

/** Payment history of purchases, cursor-paginated. */
export function usePurchaseHistory() {
  type HistoryPage = Page<PurchaseHistoryItem>;
  return useInfiniteQuery<
    HistoryPage,
    Error,
    { pages: HistoryPage[] },
    readonly unknown[],
    string | null
  >(infiniteOptions<HistoryPage>(purchaseKeys.history, '/api/app/purchases/history'));
}

// ---- Admin: coupons ----

export function useCoupons() {
  return useQuery<{ items: Coupon[] }>({
    queryKey: purchaseKeys.adminCoupons,
    queryFn: () => api.get('/api/admin/coupons'),
  });
}

export function useCreateCoupon() {
  const queryClient = useQueryClient();
  return useMutation<Coupon, Error, CouponInput>({
    mutationFn: (input) => api.post('/api/admin/coupons', input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: purchaseKeys.adminCoupons }),
  });
}

export function useUpdateCoupon(id: string) {
  const queryClient = useQueryClient();
  return useMutation<Coupon, Error, CouponInput>({
    mutationFn: (input) => api.put(`/api/admin/coupons/${id}`, input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: purchaseKeys.adminCoupons }),
  });
}

export function useToggleCoupon(id: string) {
  const queryClient = useQueryClient();
  return useMutation<Coupon, Error, boolean>({
    mutationFn: (enabled) => api.patch(`/api/admin/coupons/${id}/enabled`, { enabled }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: purchaseKeys.adminCoupons }),
  });
}

export function useCouponUses(id: string | null) {
  return useQuery<{ items: CouponUse[] }>({
    queryKey: purchaseKeys.adminCouponUses(id ?? ''),
    enabled: id !== null,
    queryFn: () => api.get(`/api/admin/coupons/${id ?? ''}/uses`),
  });
}

// ---- Admin: slot discounts ----

export function useSlotDiscounts(range: SlotDiscountRange | null) {
  return useQuery<{ items: SlotDiscount[] }>({
    queryKey: purchaseKeys.adminSlotDiscounts(range ?? { from: '', to: '' }),
    enabled: range !== null,
    queryFn: () => api.get(withQuery('/api/admin/slot-discounts', { ...range })),
  });
}

/** Discounts change what the public grid and the admin calendar show. */
function useInvalidateSlotDiscounts() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: purchaseKeys.adminSlotDiscountsAll });
    void queryClient.invalidateQueries({ queryKey: availabilityKeys.all });
    void queryClient.invalidateQueries({ queryKey: calendarKeys.all });
  };
}

export function useApplySlotDiscount() {
  const invalidate = useInvalidateSlotDiscounts();
  return useMutation<SlotDiscountApplyResult, Error, SlotDiscountInput>({
    mutationFn: (input) => api.post('/api/admin/slot-discounts', input),
    onSuccess: invalidate,
  });
}

export function useRemoveSlotDiscount() {
  const invalidate = useInvalidateSlotDiscounts();
  return useMutation<void, Error, string>({
    mutationFn: (id) => api.delete(`/api/admin/slot-discounts/${id}`),
    onSuccess: invalidate,
  });
}

// ---- Admin: subscriptions and credits ----

export function useAdminSubscriptions(filters: AdminSubscriptionFilters) {
  type AdminPage = Page<AdminSubscriptionRow>;
  return useInfiniteQuery<
    AdminPage,
    Error,
    { pages: AdminPage[] },
    readonly unknown[],
    string | null
  >(
    infiniteOptions<AdminPage>(
      purchaseKeys.adminSubscriptions(filters),
      '/api/admin/subscriptions',
      { ...filters },
    ),
  );
}

export function useAdminSubscription(id: string | null) {
  return useQuery<Subscription>({
    queryKey: purchaseKeys.adminSubscription(id ?? ''),
    enabled: id !== null,
    queryFn: () => api.get(`/api/admin/subscriptions/${id ?? ''}`),
  });
}

export function useAdminLedger(id: string | null) {
  return useInfiniteQuery<
    LedgerPage,
    Error,
    { pages: LedgerPage[] },
    readonly unknown[],
    string | null
  >(
    infiniteOptions<LedgerPage>(
      purchaseKeys.adminLedger(id ?? ''),
      `/api/admin/subscriptions/${id ?? ''}/ledger`,
      {},
      id !== null,
    ),
  );
}

export function useAdminSubscriptionQuote(request: AdminSaleInput | null) {
  return useQuery<SubscriptionQuote>({
    queryKey: ['admin', 'subscriptions', 'quote', request],
    enabled: request !== null,
    placeholderData: keepPreviousData,
    queryFn: () => api.post('/api/admin/subscriptions/quote', request),
  });
}

function useInvalidateAdminSubscriptions() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: purchaseKeys.adminSubscriptionsAll });
    void queryClient.invalidateQueries({ queryKey: ['admin', 'subscription'] });
    void queryClient.invalidateQueries({ queryKey: availabilityKeys.all });
  };
}

/** Sells a subscription at the counter (payment link or manual confirmation). */
export function useSellSubscription() {
  const invalidate = useInvalidateAdminSubscriptions();
  return useMutation<SubscriptionPurchaseResult, Error, IdempotentVariables<AdminSaleInput>>({
    mutationFn: (v) => api.post('/api/admin/subscriptions', v.body, { idempotencyKey: keyOf(v) }),
    onSuccess: invalidate,
  });
}

export function useAdminCancelSubscription(id: string) {
  const invalidate = useInvalidateAdminSubscriptions();
  return useMutation<{ subscription: Subscription }, Error, AdminCancelInput>({
    mutationFn: (input) => api.post(`/api/admin/subscriptions/${id}/cancel`, input),
    onSuccess: invalidate,
  });
}

export function useAdjustBalance(id: string) {
  const invalidate = useInvalidateAdminSubscriptions();
  return useMutation<AdjustBalanceResult, Error, BalanceAdjustInput>({
    mutationFn: (input) => api.post(`/api/admin/subscriptions/${id}/adjust-balance`, input),
    onSuccess: invalidate,
  });
}

export function useResendSaleLink(id: string) {
  return useMutation<unknown, Error, void>({
    mutationFn: () => api.post(`/api/admin/subscriptions/${id}/resend-link`, {}),
  });
}

export function useCustomerCredits(userId: string | null) {
  return useQuery<CreditsSummary>({
    queryKey: purchaseKeys.adminCustomerCredits(userId ?? ''),
    enabled: userId !== null,
    queryFn: () => api.get(`/api/admin/customers/${userId ?? ''}/credits`),
  });
}

/** Manual credit grant (admin, with justification). */
export function useGrantCredit(userId: string) {
  const queryClient = useQueryClient();
  return useMutation<GrantCreditResult, Error, IdempotentVariables<ManualCreditInput>>({
    mutationFn: (v) =>
      api.post(`/api/admin/customers/${userId}/credits`, v.body, { idempotencyKey: keyOf(v) }),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: purchaseKeys.adminCustomerCredits(userId) }),
  });
}
