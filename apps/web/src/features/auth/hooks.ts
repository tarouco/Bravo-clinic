import type { LoginInput, SignupInput, TotpDisableRequest, TotpDisableResponse } from '@bravo/core';
import {
  useMutation,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import { api } from '../../lib/api';
import { SESSION_KEY } from '../../lib/query-client';
import type { Session } from './useSession';

/** Only a path that starts with a single `/` may be used as a post-login destination. */
export function safeNextPath(next: string | null): string | null {
  if (next === null) return null;
  return /^\/(?![/\\])/.test(next) ? next : null;
}

export interface LoginResponse {
  user: Session;
  mfaRequired: boolean;
}

export function useLogin(): UseMutationResult<LoginResponse, Error, LoginInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginInput) => api.post<LoginResponse>('/api/public/auth/login', input),
    onSuccess: ({ user }) => {
      queryClient.setQueryData(SESSION_KEY, user);
    },
  });
}

export function useLogout(): UseMutationResult<void, Error, void> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<void>('/api/app/auth/logout'),
    onSuccess: () => {
      queryClient.setQueryData(SESSION_KEY, null);
    },
  });
}

export function useSignup(): UseMutationResult<{ user: Session }, Error, SignupInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SignupInput) =>
      api.post<{ user: Session }>('/api/public/auth/signup', input),
    onSuccess: ({ user }) => {
      queryClient.setQueryData(SESSION_KEY, user);
    },
  });
}

export function useVerifyEmail(): UseMutationResult<{ verified: true }, Error, { token: string }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { token: string }) =>
      api.post<{ verified: true }>('/api/public/auth/verify-email', input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SESSION_KEY }),
  });
}

export function useResendVerification(): UseMutationResult<void, Error, void> {
  return useMutation({
    mutationFn: () => api.post<void>('/api/app/auth/verify-email/resend'),
  });
}

export function useRequestPasswordReset(): UseMutationResult<void, Error, { email: string }> {
  return useMutation({
    mutationFn: (input: { email: string }) =>
      api.post<void>('/api/public/auth/password-reset/request', input),
  });
}

export function useConfirmPasswordReset(): UseMutationResult<
  void,
  Error,
  { token: string; password: string }
> {
  return useMutation({
    mutationFn: (input: { token: string; password: string }) =>
      api.post<void>('/api/public/auth/password-reset/confirm', input),
  });
}

export function useTotpEnroll(): UseMutationResult<{ otpauthUri: string }, Error, void> {
  return useMutation({
    mutationFn: () => api.post<{ otpauthUri: string }>('/api/app/auth/totp/enroll'),
  });
}

/** A successful TOTP step marks the server session verified; mirror that in the cached session. */
function markMfaVerified(queryClient: QueryClient): void {
  queryClient.setQueryData<Session | null>(SESSION_KEY, (session) =>
    session ? { ...session, mfa: { enrolled: true, verified: true } } : session,
  );
}

export function useTotpConfirm(): UseMutationResult<
  { recoveryCodes: string[] },
  Error,
  { code: string }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { code: string }) =>
      api.post<{ recoveryCodes: string[] }>('/api/app/auth/totp/confirm', input),
    onSuccess: () => markMfaVerified(queryClient),
  });
}

export function useTotpVerify(): UseMutationResult<{ ok: true }, Error, { code: string }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { code: string }) =>
      api.post<{ ok: true }>('/api/app/auth/totp/verify', input),
    onSuccess: () => markMfaVerified(queryClient),
  });
}

/** Turning TOTP off resets the server session's MFA state; mirror the answer in the cache. */
function markMfaDisabled(queryClient: QueryClient, mfa: TotpDisableResponse['mfa']): void {
  queryClient.setQueryData<Session | null>(SESSION_KEY, (session) =>
    session ? { ...session, mfa } : session,
  );
}

/** `POST /api/app/auth/totp/disable` with a current or recovery code (FND-136). */
export function useTotpDisable(): UseMutationResult<
  TotpDisableResponse,
  Error,
  TotpDisableRequest
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: TotpDisableRequest) =>
      api.post<TotpDisableResponse>('/api/app/auth/totp/disable', input),
    onSuccess: ({ mfa }) => markMfaDisabled(queryClient, mfa),
  });
}
