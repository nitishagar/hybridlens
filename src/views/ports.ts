import type { FirebaseApp } from 'firebase/app';
import {
  HybridService,
  createRealModel,
  type AppMode,
} from '../services/hybrid';
import {
  extractAndRedact,
  summarizeRedacted,
  toRedactedText,
} from '../services/redact';
import { ExtractionSchema, SummarySchema } from '../services/schemas';
import type {
  FlowPorts,
  RedactOutcome,
  SummaryOutcome,
} from '../components/types';

// Real ports: real service init/probe/badges with schema-driven redact.ts.
// knownSpans is ignored on this path (the model extracts); it exists for
// the mock ports' deterministic strip behind the same contract.

async function dataUrlToPart(
  url: string,
): Promise<{ mimeType: 'image/jpeg' | 'image/png'; base64: string }> {
  let mime = '';
  let base64 = '';
  if (url.startsWith('data:')) {
    const m = /^data:(image\/(?:jpeg|png));base64,(.+)$/.exec(url);
    if (!m) throw new Error('unsupported data URL');
    mime = m[1]!;
    base64 = m[2]!;
  } else {
    const res = await fetch(url);
    const blob = await res.blob();
    if (blob.type !== 'image/jpeg' && blob.type !== 'image/png')
      throw new Error('unsupported image type');
    mime = blob.type;
    base64 = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => {
        const s = String(fr.result ?? '');
        const i = s.indexOf('base64,');
        if (i < 0) reject(new Error('no base64 payload'));
        else resolve(s.slice(i + 7));
      };
      fr.onerror = () => reject(new Error('file read failed'));
      fr.readAsDataURL(blob);
    });
  }
  return { mimeType: mime as 'image/jpeg' | 'image/png', base64 };
}

export function createRealPorts(app: FirebaseApp, mode: AppMode): FlowPorts {
  const service = new HybridService(
    mode,
    (m, schema) => createRealModel(app, m, schema),
    { schema: SummarySchema },
  );
  // I1: extraction ALWAYS runs on-device, independent of the UI mode, so
  // raw document text can never route to the cloud from this step.
  const extractor = new HybridService(
    'ONLY_ON_DEVICE',
    (m, schema) => createRealModel(app, m, schema),
    { schema: ExtractionSchema },
  );
  return {
    mode,
    init: async (cb) => {
      await Promise.all([
        service.ensureDeviceModel(cb),
        extractor.ensureDeviceModel(),
      ]);
    },
    getInitState: () => service.getState(),
    redact: async (
      imageDataUrl: string,
      docText: string,
    ): Promise<RedactOutcome> => {
      const image = await dataUrlToPart(imageDataUrl).catch(() => undefined);
      const out = await extractAndRedact(
        (req) => extractor.generate(req),
        { text: docText, ...(image ? { image } : {}) },
      );
      return {
        redactedText: out.redacted,
        spans: out.spans,
        receipt: out.receipt,
      };
    },
    summarize: async (redactedText: string): Promise<SummaryOutcome> => {
      // Reviewed boundary: the UI only ever passes redact() output here
      // (pinned by the summary-args spy test), so this conversion is safe.
      const out = await summarizeRedacted(toRedactedText(redactedText), (req) =>
        service.generate(req),
      );
      return out;
    },
  };
}
