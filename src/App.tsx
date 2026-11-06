import { useMemo } from 'react';
import {
  probeAvailability,
  resolveFirebaseConfig,
  type AvailabilityState,
} from './services/hybrid';
import type { PortsFactory } from './components/types';
import PrivRedactView from './views/PrivRedactView';

export default function App({
  factory,
  probeFn = probeAvailability,
  skipConfigCheck = false,
}: {
  factory: PortsFactory;
  probeFn?: () => Promise<AvailabilityState>;
  skipConfigCheck?: boolean;
}) {
  const resolved = useMemo(
    () =>
      resolveFirebaseConfig(
        import.meta.env as unknown as Record<string, string | undefined>,
      ),
    [],
  );
  if (!resolved.ok && !skipConfigCheck)
    return (
      <main>
        <h1>PrivRedact</h1>
        <p role="alert">{resolved.alert}</p>
      </main>
    );
  return (
    <main>
      <h1>PrivRedact</h1>
      <PrivRedactView factory={factory} probeFn={probeFn} />
    </main>
  );
}
