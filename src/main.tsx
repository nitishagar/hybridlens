import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { getApps, initializeApp } from 'firebase/app';
import { resolveFirebaseConfig } from './services/hybrid';
import { initAppCheckForApp, resolveAppCheckConfig } from './services/appcheck';
import type { PortsFactory } from './components/types';
import { createRealPorts } from './views/ports';
import App from './App';

// Real ports: schema-driven redact.ts over HybridService (I1: extraction is
// pinned ONLY_ON_DEVICE inside the ports, independent of the UI mode).
const factory: PortsFactory = (mode) => {
  const env = import.meta.env as unknown as Record<string, string | undefined>;
  const resolved = resolveFirebaseConfig(env);
  if (!resolved.ok) throw new Error(resolved.alert);
  const appCheck = resolveAppCheckConfig(env, {
    dev: import.meta.env.DEV,
    hostname: window.location.hostname,
  });
  if (!appCheck.ok) throw new Error(appCheck.reason);
  const apps = getApps();
  const app = apps.length > 0 ? apps[0]! : initializeApp(resolved.config);
  initAppCheckForApp(app, appCheck);
  return createRealPorts(app, mode);
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App factory={factory} />
  </StrictMode>,
);
