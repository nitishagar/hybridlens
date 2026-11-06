import {
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  InferenceMode,
  InferenceSource,
} from 'firebase/ai';
import type { FirebaseApp } from 'firebase/app';
import type { GenerativeModel, HybridParams } from 'firebase/ai';
import { hybridSchemaParams } from './schemas';

export type AppMode =
  | 'PREFER_ON_DEVICE'
  | 'ONLY_ON_DEVICE'
  | 'PREFER_IN_CLOUD'
  | 'ONLY_IN_CLOUD';

export type BadgeSource = 'ON_DEVICE' | 'IN_CLOUD' | 'UNKNOWN';
export type InitState = 'idle' | 'downloading' | 'ready' | 'error';

export const CLOUD_MODEL = 'gemini-3.5-flash-lite';
const ALLOWED_CLOUD_MODELS: readonly string[] = [CLOUD_MODEL];

export const TIMEOUT_MS_DEFAULT = 300_000;
export const TIMEOUT_COPY =
  'The on-device model is still downloading after 5 minutes. ' +
  'Cancel and keep the cloud fallback, or wait and retry.';

export function assertAllowedModel(name: string): void {
  if (!ALLOWED_CLOUD_MODELS.includes(name))
    throw new ServiceError(
      'MODEL_NOT_ALLOWED',
      `Model "${name}" is not on the free-tier allowlist.`,
      false,
    );
}

export interface GenerateRequest {
  prompt: string;
  image?: { mimeType: 'image/jpeg' | 'image/png'; base64: string };
}

export interface GenerateResult {
  text: string;
  inferenceSource: BadgeSource;
  latencyMs: number;
  mode: AppMode;
  fallback: boolean;
}

export class ServiceError extends Error {
  constructor(
    readonly code: string,
    readonly copy: string,
    readonly retryable: boolean,
  ) {
    super(copy);
    this.name = 'ServiceError';
  }
}

// Minimal port over firebase's GenerativeModel: the seam every test injects.
export interface ModelResponse {
  text(): string;
  inferenceSource?: string;
}

export interface ModelPort {
  initializeDeviceModel?(onProgress?: (v: number) => void): Promise<void>;
  generateContent(
    prompt: string | unknown[],
  ): Promise<{ response: ModelResponse }>;
}

export type ModelFactory = (mode: AppMode, schema?: object) => ModelPort;

function toSdkMode(mode: AppMode): InferenceMode {
  return InferenceMode[mode];
}

// The SDK reports lowercase 'on_device'/'in_cloud' at runtime (verified in
// the installed package); accept documented spellings too, else UNKNOWN (I2).
export function normalizeSource(raw: unknown): BadgeSource {
  if (
    raw === InferenceSource.ON_DEVICE ||
    raw === 'ON_DEVICE' ||
    raw === 'on_device'
  )
    return 'ON_DEVICE';
  if (
    raw === InferenceSource.IN_CLOUD ||
    raw === 'IN_CLOUD' ||
    raw === 'in_cloud'
  )
    return 'IN_CLOUD';
  return 'UNKNOWN';
}

export function mapError(e: unknown): ServiceError {
  if (e instanceof ServiceError) return e;
  const msg = e instanceof Error ? e.message : String(e);
  const status = (e as { status?: number } | null)?.status;
  const code = (e as { code?: string } | null)?.code ?? '';
  if (
    status === 429 ||
    /quota|rate.?limit|RESOURCE_EXHAUSTED|429/i.test(`${msg} ${code}`)
  )
    return new ServiceError(
      'QUOTA',
      'Free-tier quota reached (429). Wait a minute and retry — on-device answers are unaffected.',
      true,
    );
  if (/API_NOT_ENABLED|Prompt API|LanguageModel.*undefined/i.test(`${msg} ${code}`))
    return new ServiceError(
      'DEVICE_UNAVAILABLE',
      'On-device AI is not available in this browser (needs Chrome Desktop ≥v139 with the Prompt-API flag).',
      false,
    );
  // Mock-port errors arrive with a code but no shared base class (the
  // service must not import test doubles); match structurally.
  if ((e as { name?: string } | null)?.name === 'MockAIError') {
    const mockCode = (e as { code?: string }).code ?? 'GENERATE_FAILED';
    return new ServiceError(mockCode, msg, mockCode !== 'DEVICE_UNAVAILABLE');
  }
  return new ServiceError('GENERATE_FAILED', msg || 'Generation failed.', false);
}

export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
}

const PLACEHOLDER = /YOUR_|^$/;

export function resolveFirebaseConfig(
  env: Record<string, string | undefined>,
):
  | { ok: true; config: FirebaseWebConfig }
  | { ok: false; alert: string } {
  const config: FirebaseWebConfig = {
    apiKey: env.VITE_FIREBASE_API_KEY ?? '',
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN ?? '',
    projectId: env.VITE_FIREBASE_PROJECT_ID ?? '',
    appId: env.VITE_FIREBASE_APP_ID ?? '',
  };
  if (Object.values(config).some((v) => PLACEHOLDER.test(v)))
    return {
      ok: false,
      alert:
        'Firebase is not configured. Create a project in the Firebase console → ' +
        'AI Services → AI Logic → Gemini Developer API, then fill VITE_FIREBASE_* in .env (see README).',
    };
  return { ok: true, config };
}

export type AvailabilityState =
  | 'available'
  | 'downloading'
  | 'downloadable'
  | 'unavailable'
  | 'unsupported';

export async function probeAvailability(): Promise<AvailabilityState> {
  const LM = (
    globalThis as {
      LanguageModel?: { availability: () => Promise<string> };
    }
  ).LanguageModel;
  if (!LM) return 'unsupported';
  try {
    const s = await LM.availability();
    return s === 'available' || s === 'downloading' || s === 'downloadable'
      ? s
      : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

export function createRealModel(
  app: FirebaseApp,
  mode: AppMode,
  schema?: object,
): ModelPort {
  const ai = getAI(app, { backend: new GoogleAIBackend() });
  const dual = schema ? hybridSchemaParams(schema, CLOUD_MODEL) : null;
  // Single cast: our object-typed schema meets the SDK's Schema-branded type.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const params = (dual
    ? { mode: toSdkMode(mode), ...dual }
    : {
        mode: toSdkMode(mode),
        inCloudParams: { model: CLOUD_MODEL },
      }) as HybridParams;
  const model = getGenerativeModel(ai, params);
  // Adapt the SDK model to the narrow port: our prompt union is a subset
  // the SDK types don't model, so the pass-through cast stays contained here.
  type SdkRequest = Parameters<GenerativeModel['generateContent']>[0];
  return {
    initializeDeviceModel: (cb) => model.initializeDeviceModel(cb),
    generateContent: (prompt) => model.generateContent(prompt as SdkRequest),
  };
}

export interface HybridServiceOptions {
  cloudModel?: string;
  timeoutMs?: number;
  schema?: object;
}

export class HybridService {
  private initState: InitState = 'idle';
  private initFlight: Promise<void> | null = null;
  private portMemo: ModelPort | null = null;
  private readonly timeoutMs: number;
  private readonly schema?: object;

  constructor(
    private readonly mode: AppMode,
    private readonly factory: ModelFactory,
    opts?: HybridServiceOptions,
  ) {
    if (opts?.cloudModel) assertAllowedModel(opts.cloudModel);
    this.timeoutMs = opts?.timeoutMs ?? TIMEOUT_MS_DEFAULT;
    this.schema = opts?.schema;
  }

  getState(): InitState {
    return this.initState;
  }

  private port(): ModelPort {
    if (!this.portMemo) this.portMemo = this.factory(this.mode, this.schema);
    return this.portMemo;
  }

  private async withTimeout<T>(
    p: Promise<T>,
    ms: number,
    copy: string,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        p,
        new Promise<T>(
          (_, reject) =>
            (timer = setTimeout(
              () => reject(new ServiceError('TIMEOUT', copy, false)),
              ms,
            )),
        ),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  // Gesture-gated by the CALLER (button click only, never on mount — I4).
  // Single-flight: concurrent taps share one init; failure resets to idle
  // so a re-tap retries.
  async ensureDeviceModel(onProgress?: (v: number) => void): Promise<void> {
    if (this.initState === 'ready') return;
    if (this.initFlight) return this.initFlight;
    this.initState = 'downloading';
    this.initFlight = (async () => {
      try {
        await this.withTimeout(
          this.port().initializeDeviceModel?.(onProgress) ?? Promise.resolve(),
          this.timeoutMs,
          TIMEOUT_COPY,
        );
        this.initState = 'ready';
      } catch (e) {
        this.initState = 'idle';
        throw mapError(e);
      } finally {
        this.initFlight = null;
      }
    })();
    return this.initFlight;
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    if (this.initState === 'idle')
      throw new ServiceError(
        'NEEDS_INIT',
        'Enable on-device AI first (tap the button) — the model needs one gesture-gated setup.',
        false,
      );
    if (
      this.mode === 'ONLY_ON_DEVICE' &&
      this.initState === 'downloading' &&
      this.initFlight
    ) {
      await this.withTimeout(this.initFlight, this.timeoutMs, TIMEOUT_COPY);
    }
    const input: string | unknown[] = req.image
      ? [
          req.prompt,
          {
            inlineData: {
              mimeType: req.image.mimeType,
              data: req.image.base64,
            },
          },
        ]
      : req.prompt;
    const t0 = Date.now();
    try {
      const res = await this.port().generateContent(input);
      const inferenceSource = normalizeSource(res.response.inferenceSource);
      const preferred =
        this.mode === 'PREFER_ON_DEVICE'
          ? 'ON_DEVICE'
          : this.mode === 'PREFER_IN_CLOUD'
            ? 'IN_CLOUD'
            : null;
      return {
        text: res.response.text(),
        inferenceSource,
        latencyMs: Date.now() - t0,
        mode: this.mode,
        fallback:
          preferred !== null &&
          inferenceSource !== 'UNKNOWN' &&
          inferenceSource !== preferred,
      };
    } catch (e) {
      throw mapError(e);
    }
  }
}
