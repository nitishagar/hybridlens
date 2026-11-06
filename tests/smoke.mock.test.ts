import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { installFetchGuard } from '../src/test/fetch-guard';
import {
  COPIES,
  MockAIError,
  mockGenerate,
  type MockWorld,
  type InferenceMode,
} from '../src/test/mock-hybrid';

const PROMPT = 'extract PII';

function world(o: Partial<MockWorld>): MockWorld {
  return { deviceAvailable: true, deviceDownloading: false, online: true, ...o };
}

function threw(
  mode: InferenceMode,
  w: MockWorld,
): { code: string; message: string } {
  try {
    mockGenerate(mode, w, PROMPT);
  } catch (e) {
    expect(e).toBeInstanceOf(MockAIError);
    const err = e as MockAIError;
    return { code: err.code, message: err.message };
  }
  throw new Error(`expected ${mode} to throw`);
}

describe('12-cell fault matrix', () => {
  it('PREFER_ON_DEVICE + device ok → ON_DEVICE, no fallback', () => {
    const r = mockGenerate('PREFER_ON_DEVICE', world({}), PROMPT);
    expect(r.inferenceSource).toBe('ON_DEVICE');
    expect(r.fallback).toBe(false);
  });

  it('PREFER_ON_DEVICE + device down → IN_CLOUD fallback', () => {
    const r = mockGenerate(
      'PREFER_ON_DEVICE',
      world({ deviceAvailable: false }),
      PROMPT,
    );
    expect(r.inferenceSource).toBe('IN_CLOUD');
    expect(r.fallback).toBe(true);
  });

  it('PREFER_ON_DEVICE + offline + device down → named error', () => {
    expect(
      threw('PREFER_ON_DEVICE', world({ deviceAvailable: false, online: false }))
        .message,
    ).toBe(COPIES.offlineNoDevice);
  });

  it('ONLY_ON_DEVICE + ok → ON_DEVICE', () => {
    const r = mockGenerate('ONLY_ON_DEVICE', world({}), PROMPT);
    expect(r.inferenceSource).toBe('ON_DEVICE');
    expect(r.pending).toBe(false);
  });

  it('ONLY_ON_DEVICE + unavailable → throw + error copy', () => {
    expect(
      threw(
        'ONLY_ON_DEVICE',
        world({ deviceAvailable: false, deviceDownloading: false }),
      ).message,
    ).toBe(COPIES.deviceUnavailable);
  });

  it('ONLY_ON_DEVICE + downloading → pending + progress', () => {
    const r = mockGenerate(
      'ONLY_ON_DEVICE',
      world({ deviceAvailable: false, deviceDownloading: true }),
      PROMPT,
    );
    expect(r.pending).toBe(true);
    expect(r.progress).toBeGreaterThanOrEqual(0);
  });

  it('PREFER_IN_CLOUD + online → IN_CLOUD', () => {
    const r = mockGenerate('PREFER_IN_CLOUD', world({}), PROMPT);
    expect(r.inferenceSource).toBe('IN_CLOUD');
    expect(r.fallback).toBe(false);
  });

  it('PREFER_IN_CLOUD + offline + device → ON_DEVICE fallback', () => {
    const r = mockGenerate('PREFER_IN_CLOUD', world({ online: false }), PROMPT);
    expect(r.inferenceSource).toBe('ON_DEVICE');
    expect(r.fallback).toBe(true);
  });

  it('PREFER_IN_CLOUD + offline + device down → named error', () => {
    expect(
      threw(
        'PREFER_IN_CLOUD',
        world({ online: false, deviceAvailable: false }),
      ).message,
    ).toBe(COPIES.offlineNoDevice);
  });

  it('ONLY_IN_CLOUD + online → IN_CLOUD', () => {
    const r = mockGenerate('ONLY_IN_CLOUD', world({}), PROMPT);
    expect(r.inferenceSource).toBe('IN_CLOUD');
  });

  it('ONLY_IN_CLOUD + offline → throw + error copy', () => {
    expect(threw('ONLY_IN_CLOUD', world({ online: false })).message).toBe(
      COPIES.offlineCloud,
    );
  });

  it('latency fault → latencyMs ≥ injected', () => {
    const r = mockGenerate(
      'PREFER_ON_DEVICE',
      world({ latencyMs: 150 }),
      PROMPT,
    );
    expect(r.latencyMs).toBeGreaterThanOrEqual(150);
  });

  it('omit-source fault → UNKNOWN badge', () => {
    const r = mockGenerate('PREFER_ON_DEVICE', world({ omitSource: true }), PROMPT);
    expect(r.inferenceSource).toBe('UNKNOWN');
  });
});

describe('zero-network proof', () => {
  it('unmocked fetch throws and the matrix performs zero fetch/XHR', () => {
    const guard = installFetchGuard();
    try {
      expect(() => globalThis.fetch('https://example.com')).toThrow(/blocked/);
      guard.calls.length = 0; // drop the deliberate probe; the matrix must add none
      const modes: InferenceMode[] = [
        'PREFER_ON_DEVICE',
        'ONLY_ON_DEVICE',
        'PREFER_IN_CLOUD',
        'ONLY_IN_CLOUD',
      ];
      for (const mode of modes) {
        try {
          mockGenerate(mode, world({}), PROMPT);
        } catch {
          /* error paths also must not touch network */
        }
      }
      expect(guard.calls).toHaveLength(0);
    } finally {
      guard.uninstall();
    }
  });
});

describe('banned-gate positive control', () => {
  const gate = new URL('../scripts/check-banned.sh', import.meta.url).pathname;
  const banned = new URL('./fixtures/banned/secret.txt', import.meta.url).pathname;
  const clean = new URL('./fixtures/clean/note.txt', import.meta.url).pathname;

  it('fails on the banned fixture', () => {
    expect(() => execFileSync('bash', [gate, banned], { stdio: 'pipe' })).toThrow();
  });

  it('passes on the clean fixture', () => {
    const out = execFileSync('bash', [gate, clean], { encoding: 'utf8' });
    expect(out).toContain('check-banned: OK');
  });
});
