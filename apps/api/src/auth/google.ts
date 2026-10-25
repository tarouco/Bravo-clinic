import { createHash } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { Env } from '../env';
import { randomToken } from '../lib/crypto';

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const TOKEN_TIMEOUT_MS = 10_000;

export const GOOGLE_STATE_COOKIE = 'bravo_google_oauth';
export const GOOGLE_STATE_MAX_AGE_SECONDS = 600;

export interface GoogleCredentials {
  clientId: string;
  clientSecret: string;
}

/** Google login exists only when both credentials are set (FND-134). */
export function googleCredentials(
  env: Pick<Env, 'GOOGLE_CLIENT_ID' | 'GOOGLE_CLIENT_SECRET'>,
): GoogleCredentials | null {
  if (env.GOOGLE_CLIENT_ID === undefined || env.GOOGLE_CLIENT_SECRET === undefined) return null;
  return { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET };
}

export interface Pkce {
  state: string;
  verifier: string;
  challenge: string;
}

/** Fresh `state`, PKCE verifier and its S256 challenge. */
export function createPkce(): Pkce {
  const verifier = randomToken(32);
  return {
    state: randomToken(),
    verifier,
    challenge: createHash('sha256').update(verifier).digest('base64url'),
  };
}

/** The state cookie carries `state.verifier` (both base64url, so the dot is unambiguous). */
export function encodeStateCookie(pkce: Pick<Pkce, 'state' | 'verifier'>): string {
  return `${pkce.state}.${pkce.verifier}`;
}

export function decodeStateCookie(
  value: string | undefined,
): Pick<Pkce, 'state' | 'verifier'> | null {
  if (value === undefined) return null;
  const [state, verifier, ...rest] = value.split('.');
  if (!state || !verifier || rest.length > 0) return null;
  return { state, verifier };
}

export function buildAuthorizationUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
}): string {
  // Spaces must be %20 (not "+") in the scope.
  const query = [
    ['client_id', input.clientId],
    ['redirect_uri', input.redirectUri],
    ['response_type', 'code'],
    ['scope', 'openid email profile'],
    ['state', input.state],
    ['code_challenge', input.challenge],
    ['code_challenge_method', 'S256'],
  ]
    .map(([key, value]) => `${key}=${encodeURIComponent(value ?? '')}`)
    .join('&');
  return `${GOOGLE_AUTH_URL}?${query}`;
}

/** Trades the authorization code (plus PKCE verifier) for Google's ID token. */
export async function exchangeCode(input: {
  fetch: typeof fetch;
  credentials: GoogleCredentials;
  redirectUri: string;
  code: string;
  verifier: string;
}): Promise<string> {
  const response = await input.fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: input.code,
      client_id: input.credentials.clientId,
      client_secret: input.credentials.clientSecret,
      redirect_uri: input.redirectUri,
      grant_type: 'authorization_code',
      code_verifier: input.verifier,
    }),
    signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Google token endpoint responded ${String(response.status)}`);
  const body = (await response.json()) as { id_token?: unknown };
  if (typeof body.id_token !== 'string') throw new Error('Google response has no id_token');
  return body.id_token;
}

let remoteJwks: JWTVerifyGetKey | undefined;
/** Google's signing keys, fetched and cached on first use. */
export function googleJwks(): JWTVerifyGetKey {
  remoteJwks ??= createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));
  return remoteJwks;
}

export interface GoogleProfile {
  sub: string;
  email: string;
  name: string | null;
}

/** Verifies signature, issuer, audience and expiry; the e-mail must be verified by Google. */
export async function verifyIdToken(
  idToken: string,
  input: { clientId: string; jwks: JWTVerifyGetKey },
): Promise<GoogleProfile> {
  const { payload } = await jwtVerify(idToken, input.jwks, {
    issuer: GOOGLE_ISSUERS,
    audience: input.clientId,
  });
  const { sub, email, email_verified: emailVerified, name } = payload;
  if (typeof sub !== 'string' || typeof email !== 'string' || email === '') {
    throw new Error('Google ID token lacks sub or email');
  }
  if (emailVerified !== true) throw new Error('Google e-mail is not verified');
  return { sub, email: email.trim().toLowerCase(), name: typeof name === 'string' ? name : null };
}
