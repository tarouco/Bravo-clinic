import { pushSubscriptionSchema } from '@bravo/core';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { messageOf } from '../../lib/api-errors';
import { useClinicConfigQuery } from '../config/useClinicConfig';

/**
 * Where web push stands on this device (GES-83): the first four are explanations instead of a
 * button, `off` and `on` are the two states of the toggle.
 */
export type PushStatus =
  'loading' | 'ios-not-installed' | 'unsupported' | 'denied' | 'unavailable' | 'off' | 'on';

const READY_TIMEOUT_MS = 4000;

/** iPhone and iPad (iPadOS 13+ reports itself as a touch Mac). */
function isIos(): boolean {
  const { userAgent, platform, maxTouchPoints } = navigator;
  return /iPad|iPhone|iPod/.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1);
}

/** True when the page runs from the home screen (installed PWA). */
function isStandalone(): boolean {
  const iosFlag = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const displayMode =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(display-mode: standalone)').matches;
  return iosFlag || displayMode;
}

function isSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/** The active service worker registration, or null when none becomes ready in time. */
async function registrationOrNull(): Promise<ServiceWorkerRegistration | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      resolve(null);
    }, READY_TIMEOUT_MS);
  });
  try {
    return await Promise.race([navigator.serviceWorker.ready, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** VAPID keys travel as base64url; `pushManager.subscribe` wants the raw bytes. */
export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export interface PushSubscriptionState {
  status: PushStatus;
  busy: boolean;
  /** Message of the last failed enable or disable. */
  error: string | null;
  enable: () => Promise<void>;
  disable: () => Promise<void>;
}

const FALLBACK_ERROR = 'Não foi possível concluir agora. Tente novamente.';

/**
 * Web push opt-in of the signed-in user (GES-76, GES-77, GES-83): permission, browser
 * subscription with the clinic's VAPID key, and registration on the API.
 */
export function usePushSubscription(): PushSubscriptionState {
  const config = useClinicConfigQuery();
  const vapidPublicKey = config.data?.vapidPublicKey ?? null;
  const configLoaded = !config.isPending;

  const [status, setStatus] = useState<PushStatus>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!configLoaded) return;
    let cancelled = false;
    const resolve = async (): Promise<PushStatus> => {
      if (isIos() && !isStandalone()) return 'ios-not-installed';
      if (!isSupported()) return 'unsupported';
      if (Notification.permission === 'denied') return 'denied';
      if (vapidPublicKey === null) return 'unavailable';
      const registration = await registrationOrNull();
      const existing = registration ? await registration.pushManager.getSubscription() : null;
      return existing && Notification.permission === 'granted' ? 'on' : 'off';
    };
    void resolve().then((next) => {
      if (!cancelled) setStatus(next);
    });
    return () => {
      cancelled = true;
    };
  }, [configLoaded, vapidPublicKey]);

  const enable = useCallback(async () => {
    if (vapidPublicKey === null) return;
    setBusy(true);
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission === 'denied') {
        setStatus('denied');
        return;
      }
      if (permission !== 'granted') {
        setError('Permissão não concedida. Toque em "Ativar notificações" e permita o aviso.');
        return;
      }
      const registration = await registrationOrNull();
      if (!registration) {
        setError('O app ainda está sendo preparado. Recarregue a página e tente de novo.');
        return;
      }
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToBytes(vapidPublicKey),
      });
      try {
        await api.post(
          '/api/app/push/subscriptions',
          pushSubscriptionSchema.parse(subscription.toJSON()),
        );
      } catch (failure) {
        // Do not keep a browser subscription the API does not know about.
        await subscription.unsubscribe().catch(() => false);
        throw failure;
      }
      setStatus('on');
    } catch (failure) {
      setError(messageOf(failure, FALLBACK_ERROR));
    } finally {
      setBusy(false);
    }
  }, [vapidPublicKey]);

  const disable = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const registration = await registrationOrNull();
      const subscription = registration ? await registration.pushManager.getSubscription() : null;
      if (subscription) {
        await api.delete('/api/app/push/subscriptions', { endpoint: subscription.endpoint });
        await subscription.unsubscribe();
      }
      setStatus('off');
    } catch (failure) {
      setError(messageOf(failure, FALLBACK_ERROR));
    } finally {
      setBusy(false);
    }
  }, []);

  return { status, busy, error, enable, disable };
}
