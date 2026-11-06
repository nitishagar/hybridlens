import type { RequestReceipt } from './types';

export default function RoutingDashboard({
  receipts,
}: {
  receipts: RequestReceipt[];
}) {
  if (receipts.length === 0) return <p>No requests yet.</p>;
  return (
    <table aria-label="Routing dashboard">
      <thead>
        <tr>
          <th>Step</th>
          <th>Mode</th>
          <th>Source</th>
          <th>Latency</th>
          <th>Notes</th>
        </tr>
      </thead>
      <tbody>
        {receipts.map((r, i) => (
          <tr key={i}>
            <td>{r.label}</td>
            <td>{r.mode}</td>
            <td>
              <span
                data-testid={`badge-${r.label}`}
                data-source={r.inferenceSource}
              >
                {r.inferenceSource}
              </span>
            </td>
            <td>{r.latencyMs}ms</td>
            <td>{r.fallback ? 'fallback' : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
