import { useMemo } from 'react';
import {
  probeAvailability,
  resolveFirebaseConfig,
  type AvailabilityState,
} from './services/hybrid';
import { resolveAppCheckConfig } from './services/appcheck';
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
  const appCheck = useMemo(
    () =>
      resolveAppCheckConfig(
        import.meta.env as unknown as Record<string, string | undefined>,
        { dev: import.meta.env.DEV, hostname: window.location.hostname },
      ),
    [],
  );
  const appCheckReason = appCheck.ok ? null : appCheck.reason;
  const alertText = resolved.ok ? appCheckReason : resolved.alert;
  if (alertText !== null && !skipConfigCheck)
    return (
      <main>
        <h1>PrivRedact</h1>
        <p role="alert">{alertText}</p>
      </main>
    );
  return (
    <main>
      <h1>PrivRedact</h1>
      <PrivRedactView factory={factory} probeFn={probeFn} />
    </main>
  );
}
