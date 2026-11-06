import { Schema } from 'firebase/ai';
import { z } from 'zod';

// Request-side schemas are authored with Firebase `Schema` helpers
// (authoritative, split across inCloudParams/onDeviceParams); the zod
// mirrors below parse `result.response.text()` output-side only (I5).

export const PII_TYPES = [
  'name',
  'email',
  'phone',
  'id',
  'address',
  'other',
] as const;

export const ExtractionSchema = Schema.object({
  properties: {
    spans: Schema.array({
      items: Schema.object({
        properties: {
          text: Schema.string(),
          type: Schema.enumString({ enum: [...PII_TYPES] }),
          confidence: Schema.number(),
        },
      }),
    }),
    redactedText: Schema.string(),
  },
});

export const ExtractionZod = z.object({
  spans: z.array(
    z.object({
      text: z.string(),
      type: z.enum(PII_TYPES),
      confidence: z.number(),
    }),
  ),
  redactedText: z.string(),
});

export const SummarySchema = Schema.object({
  properties: {
    vendor: Schema.string(),
    total: Schema.string(),
    date: Schema.string(),
    actions: Schema.array({ items: Schema.string() }),
  },
});

export const SummaryZod = z.object({
  vendor: z.string(),
  total: z.string(),
  date: z.string(),
  actions: z.array(z.string()),
});

export interface HybridSchemaParams {
  inCloudParams: {
    model?: string;
    generationConfig: { responseMimeType: string; responseSchema: object };
  };
  onDeviceParams: { promptOptions: { responseConstraint: object } };
}

// Dual-params builder: the same Firebase schema drives both paths so the
// contract holds regardless of routing (verified docs shape).
export function hybridSchemaParams(
  schema: object,
  cloudModel?: string,
): HybridSchemaParams {
  return {
    inCloudParams: {
      ...(cloudModel ? { model: cloudModel } : {}),
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: schema,
      },
    },
    onDeviceParams: { promptOptions: { responseConstraint: schema } },
  };
}
