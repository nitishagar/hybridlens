import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { getApps, initializeApp } from 'firebase/app';
import { resolveFirebaseConfig } from './services/hybrid';
import type { PortsFactory } from './components/types';
import { createInterimRealPorts } from './views/ports';
import App from './App';

// Interim (Phase 3): real service init/probe with plain-prompt redact +
// summarize. Phase 4 replaces the prompt functions with schema-driven
// redact.ts behind the same FlowPorts contract.
const factory: PortsFactory = (mode) => {
  const resolved = resolveFirebaseConfig(
    import.meta.env as unknown as Record<string, string | undefined>,
  );
  if (!resolved.ok) throw new Error(resolved.alert);
  const apps = getApps();
  const app = apps.length > 0 ? apps[0]! : initializeApp(resolved.config);
  return createInterimRealPorts(app, mode);
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App factory={factory} />
  </StrictMode>,
);
