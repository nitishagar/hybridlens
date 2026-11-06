import type { FirebaseApp } from 'firebase/app';
import {
  HybridService,
  createRealModel,
  type AppMode,
} from '../services/hybrid';
import type {
  FlowPorts,
  RedactOutcome,
  SummaryOutcome,
} from '../components/types';

// Interim real ports (Phase 3): real service init/probe/badges with
// plain-prompt redact/summarize. Phase 4 replaces the two prompt functions
// with schema-driven redact.ts; the FlowPorts contract does not change.

export function createInterimRealPorts(
  app: FirebaseApp,
  mode: AppMode,
): FlowPorts {
  const service = new HybridService(mode, (m) => createRealModel(app, m));
  // I1: extraction ALWAYS runs on-device, independent of the UI mode, so
  // raw document text can never route to the cloud from this step.
  const extractor = new HybridService('ONLY_ON_DEVICE', (m) =>
    createRealModel(app, m),
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
      _imageDataUrl: string,
      docText: string,
      knownSpans: string[],
    ): Promise<RedactOutcome> => {
      const r = await extractor.generate({
        prompt: `List every PII span (name, email, phone, id, address) in this document, one per line:\n${docText}`,
      });
      let redactedText = docText;
      const spans: RedactOutcome['spans'] = [];
      for (const span of knownSpans) {
        const idx = redactedText.indexOf(span);
        if (idx >= 0) {
          spans.push({ text: span, type: 'pii', start: idx, end: idx + span.length });
          redactedText =
            redactedText.slice(0, idx) + '███' + redactedText.slice(idx + span.length);
        }
      }
      return {
        redactedText,
        spans,
        receipt: {
          label: 'redact',
          mode: r.mode,
          inferenceSource: r.inferenceSource,
          latencyMs: r.latencyMs,
          fallback: r.fallback,
        },
      };
    },
    summarize: async (redactedText: string): Promise<SummaryOutcome> => {
      const r = await service.generate({
        prompt: `Summarize as JSON {"vendor","total","date","actions":[]}:\n${redactedText}`,
      });
      let summary: SummaryOutcome['summary'];
      try {
        const p = JSON.parse(r.text) as Partial<SummaryOutcome['summary']>;
        summary = {
          vendor: p.vendor ?? '',
          total: p.total ?? '',
          date: p.date ?? '',
          actions: Array.isArray(p.actions) ? p.actions.map(String) : [],
        };
      } catch {
        summary = { vendor: '', total: '', date: '', actions: [r.text] };
      }
      return {
        summary,
        receipt: {
          label: 'summary',
          mode: r.mode,
          inferenceSource: r.inferenceSource,
          latencyMs: r.latencyMs,
          fallback: r.fallback,
        },
      };
    },
  };
}
