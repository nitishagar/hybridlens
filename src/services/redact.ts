import { ExtractionZod, SummaryZod } from './schemas';
import {
  ServiceError,
  type GenerateRequest,
  type GenerateResult,
} from './hybrid';
import type {
  DocSummary,
  RedactSpan,
  RequestReceipt,
} from '../components/types';

// PII extraction + redaction policy (hard core 1). All decisions fail
// closed: anything suspicious degrades to redact-all, never to clean.

// Opaque: only this module constructs RedactedText; cloud summary accepts
// only it (compile-time I1 enforcement; runtime proven by spy tests).
declare const redactedBrand: unique symbol;
export type RedactedText = string & { readonly [redactedBrand]: 'RedactedText' };

export function toRedactedText(s: string): RedactedText {
  return s as RedactedText;
}

export const MAX_DOC_CHARS = 20_000;
export const CONFIDENCE_MIN = 0.5;

export const EXTRACTION_PROMPT =
  'You are a PII extractor. Find every PII span (name, email, phone, id, ' +
  'address) in this document. Return JSON ONLY, exactly: ' +
  '{"spans":[{"text","type","confidence 0-1"}],"redactedText":"copy of input, or empty string if this is not a readable document"}.\n';

export const SUMMARY_PROMPT =
  'Summarize as JSON ONLY, exactly {"vendor","total","date","actions":[]} ' +
  '(empty string/[] when unknown):\n';

export function applySpans(
  docText: string,
  spans: { text: string; type?: string }[],
): { redactedText: string; applied: RedactSpan[]; unfound: string[] } {
  let out = '';
  let cursor = 0;
  const applied: RedactSpan[] = [];
  const unfound: string[] = [];
  for (const s of spans) {
    if (!s.text) {
      unfound.push(s.text);
      continue;
    }
    const idx = docText.indexOf(s.text, cursor);
    if (idx < 0) {
      unfound.push(s.text);
      continue;
    }
    out += docText.slice(cursor, idx) + '███';
    applied.push({
      text: s.text,
      type: s.type ?? 'pii',
      start: out.length - 3,
      end: out.length,
    });
    cursor = idx + s.text.length;
  }
  out += docText.slice(cursor);
  return { redactedText: out, applied, unfound };
}

export function redactAll(docText: string): {
  redactedText: string;
  spans: RedactSpan[];
} {
  return {
    redactedText: docText.replace(/[^\s]/g, '█'),
    spans: docText
      ? [{ text: docText, type: 'document', start: 0, end: docText.length }]
      : [],
  };
}

export interface ExtractionOutcome {
  redacted: RedactedText;
  spans: RedactSpan[];
  receipt: RequestReceipt;
  degraded: boolean;
}

type Generate = (req: GenerateRequest) => Promise<GenerateResult>;

function receiptFor(
  label: string,
  r: GenerateResult,
): RequestReceipt {
  return {
    label,
    mode: r.mode,
    inferenceSource: r.inferenceSource,
    latencyMs: r.latencyMs,
    fallback: r.fallback,
  };
}

export async function extractAndRedact(
  generate: Generate,
  doc: { text: string; image?: GenerateRequest['image'] },
): Promise<ExtractionOutcome> {
  if (!doc.image && doc.text.trim() === '')
    throw new ServiceError(
      'EMPTY_DOCUMENT',
      'Add a document photo or text before redacting.',
      false,
    );
  if (doc.text.length > MAX_DOC_CHARS)
    throw new ServiceError(
      'DOCUMENT_TOO_LARGE',
      `Document exceeds ${MAX_DOC_CHARS} characters; shorten it and retry.`,
      false,
    );
  const r = await generate({
    prompt: doc.text ? EXTRACTION_PROMPT + doc.text : EXTRACTION_PROMPT,
    ...(doc.image ? { image: doc.image } : {}),
  });
  const receipt = receiptFor('redact', r);

  let parsed: ReturnType<typeof ExtractionZod.parse>;
  try {
    parsed = ExtractionZod.parse(JSON.parse(r.text));
  } catch {
    const all = redactAll(doc.text);
    return {
      redacted: toRedactedText(all.redactedText),
      spans: all.spans,
      receipt,
      degraded: true,
    };
  }

  if (parsed.spans.length === 0) {
    if (doc.text.trim() !== '' && parsed.redactedText.trim() === '')
      throw new ServiceError(
        'NOT_A_DOCUMENT',
        "This doesn't look like a readable document — try a clearer photo.",
        false,
      );
    return {
      redacted: toRedactedText(doc.text),
      spans: [],
      receipt,
      degraded: false,
    };
  }

  if (parsed.spans.some((s) => s.confidence < CONFIDENCE_MIN)) {
    const all = redactAll(doc.text);
    return {
      redacted: toRedactedText(all.redactedText),
      spans: all.spans,
      receipt,
      degraded: true,
    };
  }

  // Model spans may arrive out of order; applySpans advances a cursor, so
  // sort a copy by document position first (unfound sorts first → redact-all).
  const ordered = [...parsed.spans].sort(
    (a, b) => doc.text.indexOf(a.text) - doc.text.indexOf(b.text),
  );
  const { redactedText, applied, unfound } = applySpans(doc.text, ordered);
  if (unfound.length > 0) {
    const all = redactAll(doc.text);
    return {
      redacted: toRedactedText(all.redactedText),
      spans: all.spans,
      receipt,
      degraded: true,
    };
  }
  return {
    redacted: toRedactedText(redactedText),
    spans: applied,
    receipt,
    degraded: false,
  };
}

export async function summarizeRedacted(
  redacted: RedactedText,
  generate: Generate,
): Promise<{ summary: DocSummary; receipt: RequestReceipt }> {
  const r = await generate({ prompt: SUMMARY_PROMPT + redacted });
  let parsed: ReturnType<typeof SummaryZod.parse>;
  try {
    parsed = SummaryZod.parse(JSON.parse(r.text));
  } catch {
    throw new ServiceError(
      'SUMMARY_PARSE_FAILED',
      'Summary came back unreadable — retry to regenerate it.',
      true,
    );
  }
  return {
    summary: {
      vendor: parsed.vendor,
      total: parsed.total,
      date: parsed.date,
      actions: parsed.actions,
    },
    receipt: receiptFor('summary', r),
  };
}
