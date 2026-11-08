import type { FirebaseApp } from 'firebase/app';
import {
  ReCaptchaEnterpriseProvider,
  initializeAppCheck,
} from 'firebase/app-check';

// D2: App Check is enforced for AI Logic (research:62). Localhost DEV uses
// the debug flow (VITE_APPCHECK_DEBUG_TOKEN, or `true` to print a token to
// register in the console); production uses reCAPTCHA Enterprise. The site
// key is required in both cases: initializeAppCheck always needs a provider.

const PLACEHOLDER = /YOUR_|^$/;

export type AppCheckConfig =
  | { ok: true; kind: 'debug'; siteKey: string; debugToken: string | true }
  | { ok: true; kind: 'production'; siteKey: string }
  | { ok: false; reason: string };

export function resolveAppCheckConfig(
  env: Record<string, string | undefined>,
  opts: { dev: boolean; hostname: string },
): AppCheckConfig {
  const siteKey = env.VITE_APPCHECK_SITE_KEY ?? '';
  if (PLACEHOLDER.test(siteKey))
    return {
      ok: false,
      reason:
        'App Check is not configured. Create a reCAPTCHA Enterprise site ' +
        'key, then set VITE_APPCHECK_SITE_KEY in .env (see README).',
    };
  const localhost =
    opts.hostname === '' ||
    opts.hostname === 'localhost' ||
    opts.hostname === '127.0.0.1' ||
    opts.hostname === '[::1]';
  if (opts.dev && localhost)
    return {
      ok: true,
      kind: 'debug',
      siteKey,
      debugToken: env.VITE_APPCHECK_DEBUG_TOKEN || true,
    };
  return { ok: true, kind: 'production', siteKey };
}

type DebugGlobal = typeof globalThis & {
  FIREBASE_APPCHECK_DEBUG_TOKEN?: string | boolean;
};

// initializeAppCheck throws on a second call for the same app, and the
// ports factory runs per mode change, so init is guarded per app.
const inited = new WeakSet<object>();

export function initAppCheckForApp(
  app: FirebaseApp,
  config: Extract<AppCheckConfig, { ok: true }>,
  init: typeof initializeAppCheck = initializeAppCheck,
): void {
  if (inited.has(app)) return;
  inited.add(app);
  if (config.kind === 'debug')
    (globalThis as DebugGlobal).FIREBASE_APPCHECK_DEBUG_TOKEN =
      config.debugToken;
  init(app, {
    provider: new ReCaptchaEnterpriseProvider(config.siteKey),
    isTokenAutoRefreshEnabled: true,
  });
}
