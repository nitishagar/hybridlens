import { useState } from 'react';
import type { RedactSpan } from './types';

function wordsOf(text: string): { word: string; key: number }[] {
  return text
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .map((word, key) => ({ word, key }));
}

export interface DocOption {
  id: string;
  label: string;
  text: string;
  spans: string[];
}

export default function RedactView({
  imageUrl,
  fixtures,
  originalText,
  redactedText,
  spans,
  manualSpans,
  running,
  onSelectFile,
  onSelectFixture,
  onRedact,
  onToggleManual,
}: {
  imageUrl: string | null;
  fixtures: DocOption[];
  originalText: string;
  redactedText: string | null;
  spans: RedactSpan[];
  manualSpans: string[];
  running: boolean;
  onSelectFile: (f: File) => void;
  onSelectFixture: (d: DocOption) => void;
  onRedact: () => void;
  onToggleManual: (word: string) => void;
}) {
  const [revealed, setRevealed] = useState(false);

  return (
    <section aria-label="Redact">
      <div>
        <label>
          Upload document photo
          <input
            aria-label="Upload document photo"
            type="file"
            accept="image/png,image/jpeg"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onSelectFile(f);
            }}
          />
        </label>
      </div>
      <div>
        {fixtures.map((d) => (
          <button key={d.id} onClick={() => onSelectFixture(d)}>
            {d.label}
          </button>
        ))}
      </div>
      {imageUrl && (
        <div>
          <img
            alt="document"
            src={imageUrl}
            style={{ filter: revealed ? 'none' : 'blur(12px)' }}
          />
          <button
            onPointerDown={() => setRevealed(true)}
            onPointerUp={() => setRevealed(false)}
            onPointerLeave={() => setRevealed(false)}
          >
            Reveal
          </button>
        </div>
      )}
      <button onClick={onRedact} disabled={!imageUrl || running}>
        {running ? 'Redacting…' : 'Redact PII'}
      </button>
      {redactedText !== null && (
        <div>
          <h3>Redacted text</h3>
          <pre data-testid="redacted-text">{redactedText}</pre>
          <p>
            Model spans:{' '}
            {spans.length === 0
              ? 'none'
              : spans.map((s) => `${s.text} (${s.type})`).join(', ')}
          </p>
          <div aria-label="Tap a missed word to redact it">
            {wordsOf(originalText).map(({ word, key }) => (
              <button
                key={key}
                data-manual={manualSpans.includes(word) ? 'true' : 'false'}
                onClick={() => onToggleManual(word)}
              >
                {manualSpans.includes(word) ? '███' : word}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
