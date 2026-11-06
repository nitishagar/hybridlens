import type {
  AppMode,
  BadgeSource,
  InitState,
} from '../services/hybrid';

// UI/flow seam: Phase 3 drives these ports with mocks; Phase 4 implements
// the real prompt/schema versions. The UI never touches raw SDK calls.

export interface RequestReceipt {
  label: string;
  mode: AppMode;
  inferenceSource: BadgeSource;
  latencyMs: number;
  fallback: boolean;
}

export interface RedactSpan {
  text: string;
  type: string;
  start: number;
  end: number;
}

export interface RedactOutcome {
  redactedText: string;
  spans: RedactSpan[];
  receipt: RequestReceipt;
}

export interface DocSummary {
  vendor: string;
  total: string;
  date: string;
  actions: string[];
}

export interface SummaryOutcome {
  summary: DocSummary;
  receipt: RequestReceipt;
}

export interface FlowPorts {
  readonly mode: AppMode;
  init(onProgress?: (v: number) => void): Promise<void>;
  getInitState(): InitState;
  redact(
    imageDataUrl: string,
    docText: string,
    knownSpans: string[],
  ): Promise<RedactOutcome>;
  summarize(redactedText: string): Promise<SummaryOutcome>;
}

export type PortsFactory = (mode: AppMode) => FlowPorts;
