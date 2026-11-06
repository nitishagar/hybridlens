import { useState } from 'react';
import type { RedactSpan } from './types';

export interface DocOption {
  id: string;
  label: string;
  text: string;
  spans: string[];
}

export default function RedactView({
  imageUrl,
  fixtures,
  redactedText,
  spans,
  running,
  onSelectFile,
  onSelectFixture,
  onRedact,
}: {
  imageUrl: string | null;
  fixtures: DocOption[];
  redactedText: string | null;
  spans: RedactSpan[];
  running: boolean;
  onSelectFile: (f: File) => void;
  onSelectFixture: (d: DocOption) => void;
  onRedact: () => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const [manual, setManual] = useState<Set<string>>(new Set());

  const toggleManual = (t: string) =>
    setManual((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });

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
          <div>
            {spans.map((s) => (
              <button
                key={`${s.start}-${s.text}`}
                data-testid={`span-${s.text}`}
                data-manual={manual.has(s.text) ? 'true' : 'false'}
                onClick={() => toggleManual(s.text)}
              >
                {s.text} ({s.type})
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
