import { afterEach, expect, test, vi } from 'vitest';
import { ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import type { FirebaseApp } from 'firebase/app';
import {
  initAppCheckForApp,
  resolveAppCheckConfig,
} from '../src/services/appcheck';

const DEV_LOCAL = { dev: true, hostname: 'localhost' };

test('localhost dev without a debug token uses debug kind with auto token', () => {
  const c = resolveAppCheckConfig(
    { VITE_APPCHECK_SITE_KEY: 'site-key' },
    DEV_LOCAL,
  );
  expect(c).toEqual({
    ok: true,
    kind: 'debug',
    siteKey: 'site-key',
    debugToken: true,
  });
});

test('localhost dev passes through an explicit debug token', () => {
  const c = resolveAppCheckConfig(
    {
      VITE_APPCHECK_SITE_KEY: 'site-key',
      VITE_APPCHECK_DEBUG_TOKEN: 'dbg-1',
    },
    DEV_LOCAL,
  );
  expect(c).toMatchObject({ ok: true, kind: 'debug', debugToken: 'dbg-1' });
});

test('production build uses production kind even on localhost', () => {
  const c = resolveAppCheckConfig(
    { VITE_APPCHECK_SITE_KEY: 'site-key' },
    { dev: false, hostname: 'localhost' },
  );
  expect(c).toEqual({ ok: true, kind: 'production', siteKey: 'site-key' });
});

test('127.0.0.1 counts as localhost', () => {
  const c = resolveAppCheckConfig(
    { VITE_APPCHECK_SITE_KEY: 'k' },
    { dev: true, hostname: '127.0.0.1' },
  );
  expect(c).toMatchObject({ kind: 'debug' });
});

test('missing site key fails closed with an actionable reason', () => {
  for (const v of [undefined, '', 'YOUR_SITE_KEY']) {
    const c = resolveAppCheckConfig(
      v === undefined ? {} : { VITE_APPCHECK_SITE_KEY: v },
      DEV_LOCAL,
    );
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.reason).toMatch(/VITE_APPCHECK_SITE_KEY/);
  }
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>)
    .FIREBASE_APPCHECK_DEBUG_TOKEN;
});

test('init sets the debug token and an Enterprise provider, once per app', () => {
  const init = vi.fn();
  const app = {} as FirebaseApp;
  const config = {
    ok: true as const,
    kind: 'debug' as const,
    siteKey: 'k',
    debugToken: 'dbg-1',
  };
  initAppCheckForApp(app, config, init);
  initAppCheckForApp(app, config, init);
  expect(
    (globalThis as Record<string, unknown>).FIREBASE_APPCHECK_DEBUG_TOKEN,
  ).toBe('dbg-1');
  expect(init).toHaveBeenCalledTimes(1);
  expect(init.mock.calls[0]![1].provider).toBeInstanceOf(
    ReCaptchaEnterpriseProvider,
  );
});

test('production init leaves the debug token unset', () => {
  const init = vi.fn();
  initAppCheckForApp(
    {} as FirebaseApp,
    { ok: true, kind: 'production', siteKey: 'k' },
    init,
  );
  expect('FIREBASE_APPCHECK_DEBUG_TOKEN' in globalThis).toBe(false);
  expect(init).toHaveBeenCalledTimes(1);
});
