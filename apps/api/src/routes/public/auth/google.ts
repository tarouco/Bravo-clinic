import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { GOOGLE_STATE_COOKIE, GOOGLE_STATE_MAX_AGE_SECONDS } from '../../../auth/google';
import { setSessionCookie } from '../../../auth/session';
import { requestMeta } from '../../../lib/request-meta';
import { finishGoogleLogin, startGoogleLogin } from '../../../modules/auth/google.service';
import type { AppEnv } from '../../../types';

const stateCookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'Lax',
  path: '/',
} as const;

/** `GET /public/auth/google/{start,callback}`, active only when Google credentials are set (FND-131..134). */
export function googleRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.get('/google/start', (c) => {
    const { url, stateCookie } = startGoogleLogin(c.var.deps);
    setCookie(c, GOOGLE_STATE_COOKIE, stateCookie, {
      ...stateCookieOptions,
      maxAge: GOOGLE_STATE_MAX_AGE_SECONDS,
    });
    return c.redirect(url, 302);
  });
  app.get('/google/callback', async (c) => {
    const stateCookie = getCookie(c, GOOGLE_STATE_COOKIE);
    // The state is single-use whatever the outcome.
    deleteCookie(c, GOOGLE_STATE_COOKIE, stateCookieOptions);
    const result = await finishGoogleLogin(
      c.var.deps,
      { code: c.req.query('code'), state: c.req.query('state'), stateCookie },
      requestMeta(c),
    );
    setSessionCookie(c, result.session.token, result.session.maxAgeSeconds);
    return c.redirect(result.redirectTo, 302);
  });
  return app;
}
