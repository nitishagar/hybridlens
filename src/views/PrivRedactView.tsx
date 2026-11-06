import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ServiceError,
  probeAvailability as realProbe,
  type AppMode,
  type AvailabilityState,
  type InitState,
} from '../services/hybrid';
import { applySpans } from '../services/redact';
import ModeSwitcher from '../components/ModeSwitcher';
import RoutingDashboard from '../components/RoutingDashboard';
import RedactView, { type DocOption } from '../components/RedactView';
import SummaryView from '../components/SummaryView';
import type {
  DocSummary,
  FlowPorts,
  PortsFactory,
  RedactSpan,
  RequestReceipt,
} from '../components/types';

const INIT_FLAG = 'hl-init-started';

const DEMO_FIXTURES: DocOption[] = [
  {
    id: 'demo-invoice',
    label: 'Demo invoice',
    text: 'INVOICE #1\nBill To: Ada Lovelace\nEmail: ada@example.com\nTotal: Rs 1,000',
    spans: ['Ada Lovelace', 'ada@example.com'],
  },
];

const PLACEHOLDER_IMG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJErkJggg==';

function copyOf(e: unknown): string {
  return e instanceof ServiceError ? e.copy : String(e);
}

export default function PrivRedactView({
  factory,
  probeFn = realProbe,
  fixtures = DEMO_FIXTURES,
}: {
  factory: PortsFactory;
  probeFn?: () => Promise<AvailabilityState>;
  fixtures?: DocOption[];
}) {
  const [availability, setAvailability] = useState<AvailabilityState | 'checking'>(
    'checking',
  );
  const [mode, setMode] = useState<AppMode>('PREFER_ON_DEVICE');
  const ports: FlowPorts = useMemo(() => factory(mode), [factory, mode]);

  const [initUi, setInitUi] = useState<InitState>('idle');
  const [initError, setInitError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [resumable, setResumable] = useState(
    () => sessionStorage.getItem(INIT_FLAG) === '1',
  );
  const cancelled = useRef(false);

  const [doc, setDoc] = useState<{
    imageUrl: string;
    text: string;
    spans: string[];
    owned: boolean;
  } | null>(null);
  const docRef = useRef<typeof doc>(null);
  docRef.current = doc;

  const [redactRunning, setRedactRunning] = useState(false);
  const [redactedText, setRedactedText] = useState<string | null>(null);
  const [spans, setSpans] = useState<RedactSpan[]>([]);
  const [manual, setManual] = useState<string[]>([]);
  const [redactError, setRedactError] = useState<string | null>(null);

  // Tap-to-redact: chain manual words over the model output (manual words
  // can precede model spans in the doc, so union application would miss).
  const displayText =
    redactedText === null
      ? redactedText
      : applySpans(
          redactedText,
          manual.map((text) => ({ text, type: 'manual' })),
        ).redactedText;

  const toggleManual = (word: string) =>
    setManual((prev) =>
      prev.includes(word) ? prev.filter((w) => w !== word) : [...prev, word],
    );

  const [summaryRunning, setSummaryRunning] = useState(false);
  const [summary, setSummary] = useState<DocSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [receipts, setReceipts] = useState<RequestReceipt[]>([]);

  useEffect(() => {
    let live = true;
    probeFn().then((a) => {
      if (live) setAvailability(a);
    });
    return () => {
      live = false;
    };
  }, [probeFn]);

  useEffect(() => {
    if (availability === 'unsupported') setMode('ONLY_IN_CLOUD');
  }, [availability]);

  useEffect(
    () => () => {
      if (docRef.current?.owned)
        URL.revokeObjectURL(docRef.current.imageUrl);
    },
    [],
  );

  const revokeOwned = () => {
    if (docRef.current?.owned) URL.revokeObjectURL(docRef.current.imageUrl);
  };

  const changeMode = (m: AppMode) => {
    setMode(m);
    setInitUi('idle');
    setInitError(null);
    setRedactedText(null);
    setManual([]);
    setSummary(null);
    setSummaryError(null);
    setReceipts([]);
  };

  const enableAI = async () => {
    cancelled.current = false;
    setInitError(null);
    setInitUi('downloading');
    setProgress(0);
    sessionStorage.setItem(INIT_FLAG, '1');
    setResumable(true);
    try {
      await ports.init((v) => {
        if (!cancelled.current) setProgress(v);
      });
      if (cancelled.current) {
        setInitUi('idle');
        return;
      }
      setInitUi('ready');
      sessionStorage.removeItem(INIT_FLAG);
      setResumable(false);
    } catch (e) {
      if (cancelled.current) {
        setInitUi('idle');
        return;
      }
      setInitUi('error');
      setInitError(copyOf(e));
    }
  };

  const cancelInit = () => {
    cancelled.current = true;
    setInitUi('idle');
  };

  const selectFile = (f: File) => {
    revokeOwned();
    const url = URL.createObjectURL(f);
    setDoc({ imageUrl: url, text: '', spans: [], owned: true });
    setRedactedText(null);
    setManual([]);
    setSummary(null);
  };

  const selectFixture = (d: DocOption) => {
    revokeOwned();
    setDoc({ imageUrl: PLACEHOLDER_IMG, text: d.text, spans: d.spans, owned: false });
    setRedactedText(null);
    setManual([]);
    setSummary(null);
  };

  const runSummary = async (text: string) => {
    setSummaryRunning(true);
    setSummaryError(null);
    try {
      const out = await ports.summarize(text);
      setSummary(out.summary);
      setReceipts((r) => [...r, out.receipt]);
    } catch (e) {
      setSummaryError(copyOf(e));
    } finally {
      setSummaryRunning(false);
    }
  };

  const runRedact = async () => {
    if (!doc) return;
    setRedactRunning(true);
    setRedactError(null);
    setManual([]);
    setSummary(null);
    setSummaryError(null);
    try {
      const out = await ports.redact(doc.imageUrl, doc.text, doc.spans);
      setRedactedText(out.redactedText);
      setSpans(out.spans);
      setReceipts((r) => [...r, out.receipt]);
      await runSummary(out.redactedText);
    } catch (e) {
      setRedactError(copyOf(e));
    } finally {
      setRedactRunning(false);
    }
  };

  return (
    <div>
      {availability === 'checking' && <p>Checking on-device AI…</p>}
      {availability === 'unsupported' && (
        <p role="note">
          On-device AI is not available in this browser (needs Chrome Desktop
          ≥v139 with the Prompt-API flag). Running cloud-only.
        </p>
      )}
      <ModeSwitcher
        mode={mode}
        onChange={changeMode}
        disabled={initUi === 'downloading' || redactRunning}
      />
      {initUi === 'idle' && (
        <button onClick={enableAI}>
          {resumable ? 'Resume download' : 'Enable on-device AI'}
        </button>
      )}
      {initUi === 'downloading' && (
        <div>
          <p>Downloading on-device model… {Math.round(progress * 100)}%</p>
          <button onClick={cancelInit}>Cancel</button>
        </div>
      )}
      {initUi === 'error' && (
        <div role="alert">
          <p>{initError}</p>
          <button onClick={enableAI}>Retry setup</button>
        </div>
      )}
      {initUi === 'ready' && (
        <div>
          <RedactView
            imageUrl={doc?.imageUrl ?? null}
            fixtures={fixtures}
            originalText={doc?.text ?? ''}
            redactedText={displayText}
            spans={spans}
            manualSpans={manual}
            running={redactRunning}
            onSelectFile={selectFile}
            onSelectFixture={selectFixture}
            onRedact={runRedact}
            onToggleManual={toggleManual}
          />
          {redactError && <p role="alert">{redactError}</p>}
          <SummaryView
            summary={summary}
            running={summaryRunning}
            error={summaryError}
            onRetry={() => {
              if (redactedText !== null) runSummary(redactedText);
            }}
          />
        </div>
      )}
      <h2>Routing dashboard</h2>
      <RoutingDashboard receipts={receipts} />
    </div>
  );
}
