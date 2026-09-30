import { getServiceUrl, serviceUrlReady } from './endpoint';
import { askSessionStorage, publicModelsStorage, serverModelsStorage } from '@extension/storage';
import type { AskSession } from '@extension/storage';

/** `status` is 0 when the server could not be reached at all. */
class AskServiceError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'AskServiceError';
  }
}

const serverMessage = async (response: Response): Promise<string> => {
  try {
    const body = (await response.json()) as { error?: unknown; description?: unknown };
    if (typeof body.error === 'string' && body.error) return body.error;
    // Proxied Telegram Bot API errors keep Telegram's own body shape.
    if (typeof body.description === 'string' && body.description) return body.description;
  } catch {
    // Non-JSON error bodies fall back to the status line.
  }
  return `AskTab server error ${response.status}`;
};

const send = async (path: string, init: RequestInit): Promise<Response> => {
  await serviceUrlReady();
  const baseUrl = getServiceUrl();
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, init);
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new AskServiceError(`Cannot reach the AskTab server at ${baseUrl}`, 0);
  }
  if (!response.ok) throw new AskServiceError(await serverMessage(response), response.status);
  return response;
};

let accountMutation: Promise<void> = Promise.resolve();

/** Serialize account and catalog writes across concurrent login, logout, and API responses. */
const withAccountMutation = <T>(action: () => Promise<T>): Promise<T> => {
  const result = accountMutation.then(action, action);
  accountMutation = result.then(
    () => {},
    () => {},
  );
  return result;
};

const sameSession = (a: AskSession | null, b: AskSession): boolean =>
  a?.token === b.token && a.userId === b.userId;

/** Abort in-flight work as soon as the session changes or expires. */
const watchSession = (expected: AskSession, onChange: () => void): (() => void) => {
  let active = true;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleExpiry = () => {
    if (!active) return;
    const remaining = expected.expiresAt - Date.now();
    if (remaining <= 0) {
      onChange();
    } else {
      expiryTimer = setTimeout(scheduleExpiry, Math.min(remaining, 2_147_483_647));
    }
  };
  const check = () => {
    void askSessionStorage.get().then(
      current => {
        if (active && (!sameSession(current, expected) || expected.expiresAt <= Date.now())) {
          onChange();
        }
      },
      () => {
        if (active) onChange();
      },
    );
  };
  const unsubscribe = askSessionStorage.subscribe(check);
  check();
  scheduleExpiry();
  return () => {
    active = false;
    if (expiryTimer) clearTimeout(expiryTimer);
    unsubscribe();
  };
};

/** A stale 401 or logout cannot clear a newer account. */
const clearSession = (expected?: AskSession): Promise<void> =>
  withAccountMutation(async () => {
    if (expected && !sameSession(await askSessionStorage.get(), expected)) return;
    await askSessionStorage.set(null);
    await Promise.all([publicModelsStorage.set([]), serverModelsStorage.set([])]);
  });

const replaceSession = (session: AskSession): Promise<void> =>
  withAccountMutation(async () => {
    await askSessionStorage.set(session);
    await Promise.all([publicModelsStorage.set([]), serverModelsStorage.set([])]);
  });

const requestAnonymous = (path: string, init: RequestInit = {}): Promise<Response> =>
  send(path, init);

const requireSession = async (expected?: AskSession): Promise<AskSession> => {
  await serviceUrlReady();
  const session = await askSessionStorage.get();
  if (!session) throw new AskServiceError('Sign in to your AskTab account first', 401);
  if (expected && !sameSession(session, expected)) {
    throw new AskServiceError('Account changed during request', 409);
  }
  if (session.expiresAt <= Date.now()) {
    await clearSession(session);
    throw new AskServiceError('Session expired', 401);
  }
  return session;
};

/** Authenticated request; a 401 ends the local session it was sent with. */
const requestAuthorized = async (
  path: string,
  init: RequestInit = {},
  expectedSession?: AskSession,
): Promise<Response> => {
  const session = await requireSession(expectedSession);
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${session.token}`);
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (init.signal?.aborted) abort();
  else init.signal?.addEventListener('abort', abort, { once: true });
  const stopWatchingSession = watchSession(session, abort);
  try {
    const response = await send(path, { ...init, headers, signal: controller.signal });
    await requireSession(session);
    return response;
  } catch (error) {
    if (controller.signal.aborted && !init.signal?.aborted) await requireSession(session);
    if (error instanceof AskServiceError && error.status === 401) {
      // A newer sign-in may have replaced the token while this request was in flight.
      await clearSession(session);
    }
    throw error;
  } finally {
    stopWatchingSession();
    init.signal?.removeEventListener('abort', abort);
  }
};

/**
 * LLM calls reach the server relay through pi-ai, not `requestAuthorized`, so a
 * failed relay call made with the current token re-checks the session instead.
 */
const confirmSessionAfterModelError = async (
  baseUrl: string | undefined,
  token: string | undefined,
): Promise<void> => {
  if (!token || !baseUrl?.startsWith(`${getServiceUrl()}/api/llm/`)) return;
  if ((await askSessionStorage.get())?.token !== token) return;
  // A rejected session is cleared inside requestAuthorized; other failures change nothing.
  await requestAuthorized('/api/auth/me').catch(() => {});
};

export {
  AskServiceError,
  clearSession,
  confirmSessionAfterModelError,
  requestAnonymous,
  requestAuthorized,
  requireSession,
  replaceSession,
  watchSession,
  withAccountMutation,
};
