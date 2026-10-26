import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { GatewayCredentialsInput, NotificationEventsInput } from '@bravo/core';
import { api } from '../../lib/api';
import { withQuery } from '../../lib/query-string';
import type {
  CalendarOverview,
  EmailRecipient,
  FeedIssued,
  GatewayAdapter,
  GatewayOverview,
  GatewayTestResult,
  NotificationsOverview,
  OutboxPage,
  OutboxStatus,
  TestEmailResult,
} from './contracts';

// Gestao Integrações data layer: TanStack Query keys `['admin', 'integrations', ...]`, one hook
// per endpoint. Every write invalidates the tree it changed so the tabs follow each other.

export const integrationKeys = {
  all: ['admin', 'integrations'] as const,
  gateway: ['admin', 'integrations', 'gateway'] as const,
  calendar: ['admin', 'integrations', 'calendar'] as const,
  notifications: ['admin', 'integrations', 'notifications'] as const,
  outboxAll: ['admin', 'integrations', 'outbox'] as const,
  outbox: (status: OutboxStatus | '') => ['admin', 'integrations', 'outbox', status] as const,
};

// ---- Pagamentos (GES-35..GES-38) ----

const gatewayPath = (provider: string): string => `/api/admin/integrations/gateway/${provider}`;

/** `GET /api/admin/integrations/gateway` (GES-35). */
export function useGateway() {
  return useQuery<GatewayOverview>({
    queryKey: integrationKeys.gateway,
    queryFn: () => api.get('/api/admin/integrations/gateway'),
  });
}

/** `PUT .../gateway/:provider`; an empty secret keeps the stored one (GES-36). */
export function useSaveGateway(provider: string) {
  const queryClient = useQueryClient();
  return useMutation<GatewayAdapter, Error, GatewayCredentialsInput>({
    mutationFn: (input) => api.put(gatewayPath(provider), input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: integrationKeys.all }),
  });
}

/** `POST .../gateway/:provider/test`; a rejected credential is a 200 with `ok: false` (GES-37). */
export function useTestGateway(provider: string) {
  return useMutation<GatewayTestResult, Error, void>({
    mutationFn: () => api.post(`${gatewayPath(provider)}/test`),
  });
}

/** `POST .../gateway/:provider/activate` (GES-38). */
export function useActivateGateway(provider: string) {
  const queryClient = useQueryClient();
  return useMutation<unknown, Error, void>({
    mutationFn: () => api.post(`${gatewayPath(provider)}/activate`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: integrationKeys.all }),
  });
}

// ---- Calendário (GES-42, GES-43) ----

export function useCalendarFeeds() {
  return useQuery<CalendarOverview>({
    queryKey: integrationKeys.calendar,
    queryFn: () => api.get('/api/admin/integrations/calendar'),
  });
}

export interface IssueFeedVariables {
  scope: 'clinic' | 'room';
  roomId?: string;
}

/** `POST .../calendar/feeds`: replaces the active feed of the same scope and room. */
export function useIssueFeed() {
  const queryClient = useQueryClient();
  return useMutation<FeedIssued, Error, IssueFeedVariables>({
    mutationFn: (input) => api.post('/api/admin/integrations/calendar/feeds', input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: integrationKeys.calendar }),
  });
}

export function useRevokeFeed() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => api.delete(`/api/admin/integrations/calendar/feeds/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: integrationKeys.calendar }),
  });
}

// ---- E-mails (GES-65, GES-66, GES-70, GES-71) ----

const NOTIFICATIONS = '/api/admin/integrations/notifications';

export function useNotifications() {
  return useQuery<NotificationsOverview>({
    queryKey: integrationKeys.notifications,
    queryFn: () => api.get(NOTIFICATIONS),
  });
}

export function useAddRecipient() {
  const queryClient = useQueryClient();
  return useMutation<EmailRecipient, Error, { email: string }>({
    mutationFn: (input) => api.post(`${NOTIFICATIONS}/recipients`, input),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: integrationKeys.notifications }),
  });
}

export function useSetRecipientActive() {
  const queryClient = useQueryClient();
  return useMutation<EmailRecipient, Error, { id: string; active: boolean }>({
    mutationFn: ({ id, active }) => api.patch(`${NOTIFICATIONS}/recipients/${id}`, { active }),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: integrationKeys.notifications }),
  });
}

export function useDeleteRecipient() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => api.delete(`${NOTIFICATIONS}/recipients/${id}`),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: integrationKeys.notifications }),
  });
}

export function useSaveEvents() {
  const queryClient = useQueryClient();
  return useMutation<NotificationEventsInput, Error, NotificationEventsInput>({
    mutationFn: (events) => api.put(`${NOTIFICATIONS}/events`, events),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: integrationKeys.notifications }),
  });
}

/** `POST .../notifications/test`; without `to` the e-mail goes to every active recipient. */
export function useSendTestEmail() {
  const queryClient = useQueryClient();
  return useMutation<TestEmailResult, Error, { to?: string }>({
    mutationFn: (input) => api.post(`${NOTIFICATIONS}/test`, input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: integrationKeys.outboxAll }),
  });
}

/** Outbox of the last 30 days, newest first, optionally filtered by status (GES-71). */
export function useOutbox(status: OutboxStatus | '') {
  return useInfiniteQuery<
    OutboxPage,
    Error,
    { pages: OutboxPage[] },
    readonly unknown[],
    string | null
  >({
    queryKey: integrationKeys.outbox(status),
    initialPageParam: null,
    getNextPageParam: (last) => last.nextCursor,
    queryFn: ({ pageParam }) =>
      api.get<OutboxPage>(
        withQuery('/api/admin/integrations/outbox', { status, cursor: pageParam }),
      ),
  });
}
