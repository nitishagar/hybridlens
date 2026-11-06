import type { DocSummary } from './types';

export default function SummaryView({
  summary,
  running,
  error,
  onRetry,
}: {
  summary: DocSummary | null;
  running: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  return (
    <section aria-label="Summary">
      {!summary && !running && !error && <p>No summary yet.</p>}
      {running && <p>Summarizing…</p>}
      {error && (
        <div role="alert">
          <p>{error}</p>
          <button onClick={onRetry}>Retry summary</button>
        </div>
      )}
      {summary && (
        <dl>
          <dt>Vendor</dt>
          <dd>{summary.vendor}</dd>
          <dt>Total</dt>
          <dd>{summary.total}</dd>
          <dt>Date</dt>
          <dd>{summary.date}</dd>
          <dt>Actions</dt>
          <dd>{summary.actions.join('; ')}</dd>
        </dl>
      )}
    </section>
  );
}
