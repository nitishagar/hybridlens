import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAI: vi.fn(() => ({})),
  getGenerativeModel: vi.fn(),
}));

vi.mock('firebase/ai', async (importOriginal) => {
  const orig = await importOriginal<typeof import('firebase/ai')>();
  return {
    ...orig,
    getAI: mocks.getAI,
    getGenerativeModel: mocks.getGenerativeModel,
    GoogleAIBackend: class {},
  };
});

import type { FirebaseApp } from 'firebase/app';
import { createRealPorts } from '../src/views/ports';
import { ExtractionSchema, SummarySchema } from '../src/services/schemas';
import invoice from './fixtures/documents/invoice.json';

const EXTRACTION_JSON = JSON.stringify({
  spans: (invoice as { plantedPii: { span: string; type: string }[] }).plantedPii.map(
    (p) => ({ text: p.span, type: p.type, confidence: 0.95 }),
  ),
  redactedText: (invoice as { text: string }).text,
});
const SUMMARY_JSON = JSON.stringify({
  vendor: 'Acme',
  total: '1',
  date: '2026-11-06',
  actions: [],
});

function fakePort(canned: string) {
  return {
    initializeDeviceModel: vi.fn(async () => {}),
    generateContent: vi.fn(async () => ({
      response: { text: () => canned, inferenceSource: 'on_device' as const },
    })),
  };
}

beforeEach(() => {
  mocks.getGenerativeModel.mockReset();
  mocks.getGenerativeModel.mockImplementation((_ai: unknown, params: { mode: string }) =>
    fakePort(params.mode === 'only_on_device' ? EXTRACTION_JSON : SUMMARY_JSON),
  );
});

describe('real ports wire request-side schemas to the SDK', () => {
  it('extractor gets ExtractionSchema, service gets SummarySchema (dual params)', async () => {
    const ports = createRealPorts({} as FirebaseApp, 'PREFER_ON_DEVICE');
    await ports.init();
    expect(mocks.getGenerativeModel).toHaveBeenCalledTimes(2);

    const calls = mocks.getGenerativeModel.mock.calls as unknown as {
      1: {
        mode: string;
        inCloudParams: {
          model: string;
          generationConfig: { responseMimeType: string; responseSchema: unknown };
        };
        onDeviceParams: { promptOptions: { responseConstraint: unknown } };
      };
    }[];
    const byMode = Object.fromEntries(calls.map((c) => [c[1].mode, c[1]]));
    const extractor = byMode['only_on_device']!;
    const service = byMode['prefer_on_device']!;

    expect(extractor.inCloudParams.generationConfig.responseMimeType).toBe(
      'application/json',
    );
    expect(extractor.inCloudParams.generationConfig.responseSchema).toBe(
      ExtractionSchema,
    );
    expect(extractor.onDeviceParams.promptOptions.responseConstraint).toBe(
      ExtractionSchema,
    );
    expect(service.inCloudParams.generationConfig.responseSchema).toBe(
      SummarySchema,
    );
    expect(service.onDeviceParams.promptOptions.responseConstraint).toBe(
      SummarySchema,
    );
  });

  it('redact uses the extractor model output, ignoring knownSpans', async () => {
    const ports = createRealPorts({} as FirebaseApp, 'PREFER_ON_DEVICE');
    await ports.init();
    const fx = invoice as { text: string; plantedPii: { span: string }[] };
    const out = await ports.redact('data:image/png;base64,AAA', fx.text, [
      'Acme',
    ]);
    for (const p of fx.plantedPii) expect(out.redactedText).not.toContain(p.span);
    expect(out.redactedText).toContain('Acme'); // knownSpans ignored on real path
    expect(out.receipt.inferenceSource).toBe('ON_DEVICE');
  });

  it('summarize parses the service model output', async () => {
    const ports = createRealPorts({} as FirebaseApp, 'PREFER_ON_DEVICE');
    await ports.init();
    const out = await ports.summarize('redacted…');
    expect(out.summary.vendor).toBe('Acme');
    expect(out.receipt.label).toBe('summary');
  });
});
