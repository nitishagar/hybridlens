import {
  HybridService,
  ServiceError,
  type AppMode,
  type InitState,
} from '../services/hybrid';
import type {
  DocSummary,
  FlowPorts,
  RedactOutcome,
  RedactSpan,
  SummaryOutcome,
} from '../components/types';
import {
  MockModelPort,
  type MockFaults,
  type MockWorld,
} from './mock-hybrid';
import { applySpans } from '../services/redact';

// Mock flow ports for UI tests and offline dev: the REAL HybridService
// (init machine, badges, errors) over mock model ports, with deterministic
// redact/summarize logic. Never ships in the production UI (I2 honesty).

export interface MockFlowOptions {
  world?: Partial<MockWorld>;
  faults?: MockFaults;
  slowInit?: boolean;
  summaryFailuresLeft?: number;
}

export class MockFlowPorts implements FlowPorts {
  readonly mode: AppMode;
  readonly service: HybridService;
  readonly port: MockModelPort;
  readonly summarizeCalls: string[] = [];
  private releaseInit: (() => void) | null = null;
  private summaryFailuresLeft: number;

  constructor(mode: AppMode, opts: MockFlowOptions = {}) {
    this.mode = mode;
    const world: MockWorld = {
      deviceAvailable: true,
      deviceDownloading: false,
      online: true,
      ...opts.world,
    };
    this.port = new MockModelPort(mode, world, opts.faults ?? {});
    const port = this.port;
    this.service = new HybridService(mode, () => port, { timeoutMs: 5000 });
    this.summaryFailuresLeft = opts.summaryFailuresLeft ?? 0;
    if (opts.slowInit) {
      const orig = this.service.ensureDeviceModel.bind(this.service);
      this.service.ensureDeviceModel = async (cb) => {
        await new Promise<void>((res) => {
          this.releaseInit = res;
        });
        return orig(cb);
      };
    }
  }

  releaseSlowInit(): void {
    this.releaseInit?.();
  }

  async init(onProgress?: (v: number) => void): Promise<void> {
    return this.service.ensureDeviceModel(onProgress);
  }

  getInitState(): InitState {
    return this.service.getState();
  }

  async redact(
    _imageDataUrl: string,
    docText: string,
    knownSpans: string[],
  ): Promise<RedactOutcome> {
    const r = await this.service.generate({ prompt: `redact:${docText}` });
    // Shared strip engine with the real policy; scripted spans stay exact.
    const { redactedText, applied } = applySpans(
      docText,
      knownSpans.map((text) => ({ text, type: 'pii' as const })),
    );
    const spans: RedactSpan[] = applied;
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
  }

  async summarize(redactedText: string): Promise<SummaryOutcome> {
    this.summarizeCalls.push(redactedText);
    if (this.summaryFailuresLeft > 0) {
      this.summaryFailuresLeft--;
      throw new ServiceError('SUMMARY_FAILED', 'Summary failed (injected).', true);
    }
    const r = await this.service.generate({ prompt: `summarize:${redactedText}` });
    const summary: DocSummary = {
      vendor: 'Acme Paper Co',
      total: 'Rs 48,200',
      date: '2026-11-20',
      actions: ['Pay by due date'],
    };
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
  }
}
