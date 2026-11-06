// Mock HybridService port: deterministic Firebase AI Logic hybrid-routing
// stand-in with fault injection. Mirrors the verified SDK contract:
// PREFER_* fall back; ONLY_* throw when unavailable, wait while downloading.

import type { ModelPort } from '../services/hybrid';

// Single source of truth for the mode union lives in services/hybrid.
import type { AppMode as InferenceMode } from '../services/hybrid';
export type { InferenceMode };

export type InferenceSource = 'ON_DEVICE' | 'IN_CLOUD' | 'UNKNOWN';

export interface MockWorld {
  deviceAvailable: boolean;
  deviceDownloading: boolean;
  online: boolean;
  omitSource?: boolean;
  latencyMs?: number;
}

export interface MockFaults {
  fail429?: boolean;
  hangInit?: boolean;
}

export interface GenerateSuccess {
  ok: true;
  text: string;
  inferenceSource: InferenceSource;
  latencyMs: number;
  mode: InferenceMode;
  fallback: boolean;
  pending: boolean;
  progress?: number;
}

export type MockErrorCode =
  | 'DEVICE_UNAVAILABLE'
  | 'OFFLINE'
  | 'OFFLINE_NO_DEVICE';

export const COPIES = {
  deviceUnavailable:
    'On-device model unavailable and mode forbids cloud fallback.',
  offlineCloud: 'Offline: the cloud model cannot be reached.',
  offlineNoDevice:
    "You're offline and the on-device model isn't downloaded.",
} as const;

export class MockAIError extends Error {
  readonly code: MockErrorCode;
  constructor(code: MockErrorCode, message: string) {
    super(message);
    this.name = 'MockAIError';
    this.code = code;
  }
}

export function mockGenerate(
  mode: InferenceMode,
  world: MockWorld,
  prompt: string,
): GenerateSuccess {
  const latencyMs = world.latencyMs ?? 0;
  const source = (s: 'ON_DEVICE' | 'IN_CLOUD'): InferenceSource =>
    world.omitSource ? 'UNKNOWN' : s;
  const ok = (
    s: 'ON_DEVICE' | 'IN_CLOUD',
    fallback: boolean,
  ): GenerateSuccess => ({
    ok: true,
    text: `mock:${mode}:${prompt.length}`,
    inferenceSource: source(s),
    latencyMs,
    mode,
    fallback,
    pending: false,
  });
  const fail = (code: MockErrorCode, message: string): never => {
    throw new MockAIError(code, message);
  };

  switch (mode) {
    case 'PREFER_ON_DEVICE':
      if (world.deviceAvailable) return ok('ON_DEVICE', false);
      if (!world.online) return fail('OFFLINE_NO_DEVICE', COPIES.offlineNoDevice);
      return ok('IN_CLOUD', true);
    case 'ONLY_ON_DEVICE':
      if (world.deviceDownloading && !world.deviceAvailable)
        return { ...ok('ON_DEVICE', false), text: '', pending: true, progress: 0.5 };
      if (!world.deviceAvailable)
        return fail('DEVICE_UNAVAILABLE', COPIES.deviceUnavailable);
      return ok('ON_DEVICE', false);
    case 'PREFER_IN_CLOUD':
      if (world.online) return ok('IN_CLOUD', false);
      if (world.deviceAvailable) return ok('ON_DEVICE', true);
      return fail('OFFLINE_NO_DEVICE', COPIES.offlineNoDevice);
    case 'ONLY_IN_CLOUD':
      if (!world.online) return fail('OFFLINE', COPIES.offlineCloud);
      return ok('IN_CLOUD', false);
  }
}

// SDK-shaped mock port for HybridService tests. Reports lowercase runtime
// source values ('on_device'/'in_cloud') exactly like the real SDK so the
// service normalizer is genuinely exercised; omits the field on omitSource.
export class MockModelPort implements ModelPort {
  initCalls = 0;

  constructor(
    readonly mode: InferenceMode,
    readonly world: MockWorld,
    readonly faults: MockFaults = {},
  ) {}

  async initializeDeviceModel(onProgress?: (v: number) => void): Promise<void> {
    this.initCalls++;
    onProgress?.(0.1);
    if (this.faults.hangInit) await new Promise<void>(() => {});
    onProgress?.(1);
  }

  async generateContent(prompt: string | unknown[]): Promise<{
    response: { text: () => string; inferenceSource?: string };
  }> {
    if (this.faults.fail429)
      throw Object.assign(new Error('quota exceeded'), { status: 429 });
    const p = typeof prompt === 'string' ? prompt : 'image-input';
    const r = mockGenerate(this.mode, this.world, p);
    if (r.pending)
      throw new MockAIError(
        'DEVICE_UNAVAILABLE',
        'mock port requires completed init (service must gate)',
      );
    return {
      response: {
        text: () => r.text,
        inferenceSource:
          r.inferenceSource === 'UNKNOWN'
            ? undefined
            : r.inferenceSource === 'ON_DEVICE'
              ? 'on_device'
              : 'in_cloud',
      },
    };
  }
}
