import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HybridService,
  ServiceError,
  TIMEOUT_MS_DEFAULT,
  assertAllowedModel,
  normalizeSource,
  probeAvailability,
  resolveFirebaseConfig,
} from '../src/services/hybrid';
import type { AppMode } from '../src/services/hybrid';
import {
  ExtractionSchema,
  ExtractionZod,
  SummarySchema,
  SummaryZod,
  hybridSchemaParams,
} from '../src/services/schemas';
import {
  MockModelPort,
  type MockFaults,
  type MockWorld,
} from '../src/test/mock-hybrid';

function world(o: Partial<MockWorld>): MockWorld {
  return { deviceAvailable: true, deviceDownloading: false, online: true, ...o };
}

function svc(
  mode: AppMode,
  w: MockWorld,
  faults: MockFaults = {},
  opts?: { timeoutMs?: number; cloudModel?: string },
): { service: HybridService; port: MockModelPort } {
  const port = new MockModelPort(mode, w, faults);
  return { service: new HybridService(mode, () => port, opts), port };
}

async function ready(
  s: HybridService,
): Promise<HybridService> {
  await s.ensureDeviceModel();
  return s;
}

describe('4-mode matrix vs fault mock', () => {
  it('PREFER_ON_DEVICE + device down → IN_CLOUD fallback', async () => {
    const { service } = svc(
      'PREFER_ON_DEVICE',
      world({ deviceAvailable: false }),
    );
    const r = await (await ready(service)).generate({ prompt: 'hi' });
    expect(r.inferenceSource).toBe('IN_CLOUD');
    expect(r.fallback).toBe(true);
  });

  it('PREFER_IN_CLOUD + offline + device → ON_DEVICE fallback', async () => {
    const { service } = svc('PREFER_IN_CLOUD', world({ online: false }));
    const r = await (await ready(service)).generate({ prompt: 'hi' });
    expect(r.inferenceSource).toBe('ON_DEVICE');
    expect(r.fallback).toBe(true);
  });

  it('ONLY_ON_DEVICE + unavailable → throws with error copy', async () => {
    const { service } = svc(
      'ONLY_ON_DEVICE',
      world({ deviceAvailable: false, deviceDownloading: false }),
    );
    await expect(
      (await ready(service)).generate({ prompt: 'hi' }),
    ).rejects.toThrow(/unavailable/i);
  });

  it('ONLY_IN_CLOUD + offline → throws with error copy', async () => {
    const { service } = svc('ONLY_IN_CLOUD', world({ online: false }));
    await expect(
      (await ready(service)).generate({ prompt: 'hi' }),
    ).rejects.toThrow(/offline/i);
  });

  it('badges match injected source (lowercase SDK values normalized)', async () => {
    const a = svc('ONLY_ON_DEVICE', world({}));
    const ra = await (await ready(a.service)).generate({ prompt: 'hi' });
    expect(ra.inferenceSource).toBe('ON_DEVICE');
    const b = svc('ONLY_IN_CLOUD', world({}));
    const rb = await (await ready(b.service)).generate({ prompt: 'hi' });
    expect(rb.inferenceSource).toBe('IN_CLOUD');
    expect(ra.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('omitted source renders UNKNOWN badge', async () => {
    const { service } = svc('PREFER_ON_DEVICE', world({ omitSource: true }));
    const r = await (await ready(service)).generate({ prompt: 'hi' });
    expect(r.inferenceSource).toBe('UNKNOWN');
    expect(r.fallback).toBe(false);
  });

  it('normalizeSource accepts documented + runtime spellings', () => {
    expect(normalizeSource('on_device')).toBe('ON_DEVICE');
    expect(normalizeSource('ON_DEVICE')).toBe('ON_DEVICE');
    expect(normalizeSource('in_cloud')).toBe('IN_CLOUD');
    expect(normalizeSource(undefined)).toBe('UNKNOWN');
    expect(normalizeSource('bogus')).toBe('UNKNOWN');
  });

  it('image requests build multimodal input and resolve', async () => {
    const { service } = svc('PREFER_ON_DEVICE', world({}));
    const r = await (await ready(service)).generate({
      prompt: 'describe',
      image: { mimeType: 'image/jpeg', base64: 'AAA' },
    });
    expect(r.inferenceSource).toBe('ON_DEVICE');
  });

  it('generate before init → NEEDS_INIT (gesture rule enforced)', async () => {
    const { service } = svc('ONLY_ON_DEVICE', world({}));
    await expect(service.generate({ prompt: 'hi' })).rejects.toThrow(
      /Enable on-device AI first/,
    );
  });
});

describe('ONLY+downloading wait path', () => {
  it('pends with progress, then times out with cancel copy (fake timers)', async () => {
    vi.useFakeTimers();
    try {
      const { service } = svc(
        'ONLY_ON_DEVICE',
        world({ deviceAvailable: false, deviceDownloading: true }),
        { hangInit: true },
      );
      expect(TIMEOUT_MS_DEFAULT).toBe(300_000);
      const progress: number[] = [];
      const p = service.ensureDeviceModel((v) => progress.push(v));
      const assertion = expect(p).rejects.toThrow(/Cancel/);
      await vi.advanceTimersByTimeAsync(300_000);
      await assertion;
      expect(progress.length).toBeGreaterThan(0);
      expect(service.getState()).toBe('idle'); // failure resets for re-tap
    } finally {
      vi.useRealTimers();
    }
  });

  it('double-init single-flights (one underlying call)', async () => {
    const { service, port } = svc('ONLY_ON_DEVICE', world({}));
    await Promise.all([service.ensureDeviceModel(), service.ensureDeviceModel()]);
    expect(port.initCalls).toBe(1);
    expect(service.getState()).toBe('ready');
  });

  it('import + construct triggers zero port interactions (no auto-init)', async () => {
    // Fresh module instance, distinct from the top-level import.
    vi.resetModules();
    const fresh = await import('../src/services/hybrid');
    const calls: string[] = [];
    new fresh.HybridService('ONLY_ON_DEVICE', () => {
      calls.push('factory');
      return new MockModelPort('ONLY_ON_DEVICE', world({}));
    });
    expect(calls).toHaveLength(0);
  });
});

describe('allowlist + errors + config', () => {
  it('allowlist rejects unknown model', () => {
    expect(() => assertAllowedModel('evil-model')).toThrow(/allowlist/);
    expect(
      () =>
        new HybridService('ONLY_ON_DEVICE', () => new MockModelPort('ONLY_ON_DEVICE', world({})), {
          cloudModel: 'evil-model',
        }),
    ).toThrow(/allowlist/);
  });

  it('429 injection shows graceful quota copy', async () => {
    const { service } = svc('PREFER_ON_DEVICE', world({}), { fail429: true });
    const err = await (await ready(service))
      .generate({ prompt: 'hi' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServiceError);
    expect((err as ServiceError).copy).toMatch(/quota/i);
    expect((err as ServiceError).retryable).toBe(true);
  });

  it('placeholder config shows setup alert', () => {
    const missing = resolveFirebaseConfig({});
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.alert).toMatch(/Firebase console/);
    const placeholders = resolveFirebaseConfig({
      VITE_FIREBASE_API_KEY: 'YOUR_API_KEY',
      VITE_FIREBASE_AUTH_DOMAIN: 'YOUR_AUTH_DOMAIN',
      VITE_FIREBASE_PROJECT_ID: 'YOUR_PROJECT_ID',
      VITE_FIREBASE_APP_ID: 'YOUR_APP_ID',
    });
    expect(placeholders.ok).toBe(false);
    const full = resolveFirebaseConfig({
      VITE_FIREBASE_API_KEY: 'k',
      VITE_FIREBASE_AUTH_DOMAIN: 'd',
      VITE_FIREBASE_PROJECT_ID: 'p',
      VITE_FIREBASE_APP_ID: 'a',
    });
    expect(full.ok).toBe(true);
  });
});

describe('probeAvailability', () => {
  const g = globalThis as { LanguageModel?: unknown };
  const prev = g.LanguageModel;
  afterEach(() => {
    if (prev === undefined) delete g.LanguageModel;
    else g.LanguageModel = prev;
  });

  it('unsupported without LanguageModel', async () => {
    delete g.LanguageModel;
    await expect(probeAvailability()).resolves.toBe('unsupported');
  });

  it('passes through availability states', async () => {
    g.LanguageModel = { availability: async () => 'downloading' };
    await expect(probeAvailability()).resolves.toBe('downloading');
    g.LanguageModel = { availability: async () => 'available' };
    await expect(probeAvailability()).resolves.toBe('available');
  });

  it('throwing availability → unavailable', async () => {
    g.LanguageModel = {
      availability: async () => {
        throw new Error('nope');
      },
    };
    await expect(probeAvailability()).resolves.toBe('unavailable');
  });
});

describe('schemas (authoritative Firebase Schema + zod mirrors)', () => {
  it('hybridSchemaParams splits across both paths', () => {
    const p = hybridSchemaParams(ExtractionSchema);
    expect(p.inCloudParams.generationConfig.responseMimeType).toBe(
      'application/json',
    );
    expect(p.inCloudParams.generationConfig.responseSchema).toBe(
      ExtractionSchema,
    );
    expect(p.onDeviceParams.promptOptions.responseConstraint).toBe(
      ExtractionSchema,
    );
    const withModel = hybridSchemaParams(SummarySchema, 'm');
    expect(withModel.inCloudParams.model).toBe('m');
  });

  it('zod mirrors parse valid output and reject junk', () => {
    expect(() =>
      ExtractionZod.parse({ spans: [], redactedText: 'x' }),
    ).not.toThrow();
    expect(() => ExtractionZod.parse({ nope: 1 })).toThrow();
    expect(() =>
      SummaryZod.parse({ vendor: 'a', total: 'b', date: 'c', actions: [] }),
    ).not.toThrow();
    expect(() => SummaryZod.parse('junk')).toThrow();
  });
});
