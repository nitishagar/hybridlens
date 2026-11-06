import { describe, expect, it } from 'vitest';
import {
  extractAndRedact,
  redactAll,
  summarizeRedacted,
  toRedactedText,
  applySpans,
} from '../src/services/redact';
import {
  HybridService,
  ServiceError,
  type GenerateRequest,
  type GenerateResult,
} from '../src/services/hybrid';
import { MockModelPort } from '../src/test/mock-hybrid';
import { installFetchGuard } from '../src/test/fetch-guard';
import invoice from './fixtures/documents/invoice.json';
import receipt from './fixtures/documents/receipt.json';
import form from './fixtures/documents/form.json';
import clean from './fixtures/documents/clean.json';
import edge from './fixtures/documents/edge.json';

interface Fixture {
  text: string;
  plantedPii: { span: string; type: string }[];
}

function stubGenerate(
  text: string,
  extra: Partial<GenerateResult> = {},
): (req: GenerateRequest) => Promise<GenerateResult> {
  return async () => ({
    text,
    inferenceSource: 'ON_DEVICE',
    latencyMs: 5,
    mode: 'ONLY_ON_DEVICE',
    fallback: false,
    ...extra,
  });
}

function validExtractionJson(fx: Fixture): string {
  return JSON.stringify({
    spans: fx.plantedPii.map((p) => ({
      text: p.span,
      type: p.type,
      confidence: 0.9,
    })),
    redactedText: fx.text,
  });
}

describe('policy-wiring eval (scripted mocks, NOT a recall measure)', () => {
  const piiFixtures: [string, Fixture][] = [
    ['invoice', invoice as Fixture],
    ['receipt', receipt as Fixture],
    ['form', form as Fixture],
  ];

  for (const [name, fx] of piiFixtures) {
    it(`${name}: planted PII fully redacted, receipt honest`, async () => {
      const out = await extractAndRedact(
        stubGenerate(validExtractionJson(fx)),
        { text: fx.text },
      );
      for (const p of fx.plantedPii) expect(out.redacted).not.toContain(p.span);
      expect(out.redacted).toContain('███');
      expect(out.degraded).toBe(false);
      expect(out.receipt.label).toBe('redact');
      expect(out.receipt.inferenceSource).toBe('ON_DEVICE');
    });
  }

  it('out-of-order spans still all apply', async () => {
    const fx = invoice as Fixture;
    const reversed = [...fx.plantedPii].reverse();
    const out = await extractAndRedact(
      stubGenerate(
        JSON.stringify({
          spans: reversed.map((p) => ({
            text: p.span,
            type: p.type,
            confidence: 0.9,
          })),
          redactedText: fx.text,
        }),
      ),
      { text: fx.text },
    );
    expect(out.degraded).toBe(false);
    for (const p of fx.plantedPii) expect(out.redacted).not.toContain(p.span);
  });

  it('clean doc echoes input with zero spans', async () => {
    const out = await extractAndRedact(
      stubGenerate(JSON.stringify({ spans: [], redactedText: clean.text })),
      { text: clean.text },
    );
    expect(out.redacted).toBe(clean.text);
    expect(out.spans).toHaveLength(0);
    expect(out.degraded).toBe(false);
  });

  it('empty input → EMPTY_DOCUMENT copy', async () => {
    await expect(
      extractAndRedact(stubGenerate('{}'), { text: edge.text }),
    ).rejects.toThrow(/photo or text/);
  });

  it('malformed JSON → redact-all fallback', async () => {
    const out = await extractAndRedact(stubGenerate('{nope'), {
      text: invoice.text,
    });
    expect(out.degraded).toBe(true);
    for (const p of (invoice as Fixture).plantedPii)
      expect(out.redacted).not.toContain(p.span);
    expect(out.redacted).not.toMatch(/[A-Za-z0-9]/);
  });

  it('low confidence → redact-all', async () => {
    const fx = invoice as Fixture;
    const out = await extractAndRedact(
      stubGenerate(
        JSON.stringify({
          spans: fx.plantedPii.map((p) => ({
            text: p.span,
            type: p.type,
            confidence: 0.3,
          })),
          redactedText: fx.text,
        }),
      ),
      { text: fx.text },
    );
    expect(out.degraded).toBe(true);
    for (const p of fx.plantedPii) expect(out.redacted).not.toContain(p.span);
  });

  it('missing confidence → redact-all (schema rejects)', async () => {
    const fx = invoice as Fixture;
    const out = await extractAndRedact(
      stubGenerate(
        JSON.stringify({
          spans: fx.plantedPii.map((p) => ({ text: p.span, type: p.type })),
          redactedText: fx.text,
        }),
      ),
      { text: fx.text },
    );
    expect(out.degraded).toBe(true);
  });

  it('unfound span → redact-all (fail closed)', async () => {
    const out = await extractAndRedact(
      stubGenerate(
        JSON.stringify({
          spans: [
            { text: 'ZZZ-not-in-doc', type: 'name', confidence: 0.99 },
          ],
          redactedText: invoice.text,
        }),
      ),
      { text: invoice.text },
    );
    expect(out.degraded).toBe(true);
  });

  it('empty redactedText + zero spans → NOT_A_DOCUMENT copy', async () => {
    await expect(
      extractAndRedact(
        stubGenerate(JSON.stringify({ spans: [], redactedText: '  ' })),
        { text: invoice.text },
      ),
    ).rejects.toThrow(/readable document/);
  });

  it('oversized input → DOCUMENT_TOO_LARGE copy', async () => {
    await expect(
      extractAndRedact(stubGenerate('{}'), { text: 'x'.repeat(20001) }),
    ).rejects.toThrow(/exceeds 20000/);
  });

  it('blocked-network run completes redact with zero fetch/XHR', async () => {
    const guard = installFetchGuard();
    try {
      const svc = new HybridService(
        'ONLY_ON_DEVICE',
        (m) =>
          new MockModelPort(m, {
            deviceAvailable: true,
            deviceDownloading: false,
            online: false,
          }),
      );
      await svc.ensureDeviceModel();
      const out = await extractAndRedact(
        (req) => svc.generate(req),
        { text: invoice.text },
      );
      expect(out.degraded).toBe(true); // mock text is not JSON → redact-all
      expect(guard.calls).toHaveLength(0);
    } finally {
      guard.uninstall();
    }
  });

  it('summarizeRedacted parses valid JSON; malformed throws retryable', async () => {
    const ok = await summarizeRedacted(
      toRedactedText('redacted…'),
      stubGenerate(
        JSON.stringify({ vendor: 'V', total: 'T', date: 'D', actions: ['a'] }),
        { inferenceSource: 'IN_CLOUD', mode: 'PREFER_ON_DEVICE', fallback: true },
      ),
    );
    expect(ok.summary.vendor).toBe('V');
    expect(ok.receipt.label).toBe('summary');
    const err = await summarizeRedacted(toRedactedText('x'), stubGenerate('junk')).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ServiceError);
    expect((err as ServiceError).code).toBe('SUMMARY_PARSE_FAILED');
    expect((err as ServiceError).retryable).toBe(true);
  });

  it('full loop: 0 raw-PII leaks to the cloud-summary spy', async () => {
    const fx = invoice as Fixture;
    const seen: string[] = [];
    const spyGenerate = async (
      req: GenerateRequest,
    ): Promise<GenerateResult> => {
      seen.push(typeof req.prompt === 'string' ? req.prompt : '[parts]');
      if (seen.length === 1)
        return {
          text: validExtractionJson(fx),
          inferenceSource: 'ON_DEVICE',
          latencyMs: 1,
          mode: 'ONLY_ON_DEVICE',
          fallback: false,
        };
      return {
        text: JSON.stringify({ vendor: '', total: '', date: '', actions: [] }),
        inferenceSource: 'IN_CLOUD',
        latencyMs: 1,
        mode: 'PREFER_ON_DEVICE',
        fallback: true,
      };
    };
    const ext = await extractAndRedact(spyGenerate, { text: fx.text });
    await summarizeRedacted(ext.redacted, spyGenerate);
    expect(seen).toHaveLength(2);
    for (const p of fx.plantedPii) expect(seen[1]).not.toContain(p.span);
  });

  it('applySpans/redactAll units', () => {
    const a = applySpans('hello Ada, bye Ada', [
      { text: 'Ada' },
      { text: 'Ada' },
    ]);
    expect(a.redactedText).toBe('hello ███, bye ███');
    expect(a.unfound).toHaveLength(0);
    const b = applySpans('hi', [{ text: 'missing' }]);
    expect(b.unfound).toEqual(['missing']);
    expect(redactAll('ab cd').redactedText).toBe('██ ██');
  });
});
