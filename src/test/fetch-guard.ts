// Zero-network guard (I9): installed by tests to prove the mocked paths
// perform no fetch/XHR. Hand-rolled on purpose — no MSW dependency.

export interface FetchGuard {
  calls: string[];
  uninstall: () => void;
}

export function installFetchGuard(): FetchGuard {
  const calls: string[] = [];
  const prevFetch = globalThis.fetch;
  const prevXhr =
    'XMLHttpRequest' in globalThis
      ? (globalThis as { XMLHttpRequest: unknown }).XMLHttpRequest
      : undefined;

  const blocked = (...args: unknown[]): never => {
    calls.push(String(args[0]));
    throw new Error('fetch blocked by zero-network guard (I9)');
  };
  globalThis.fetch = blocked as typeof fetch;
  if (prevXhr !== undefined) {
    (globalThis as { XMLHttpRequest: unknown }).XMLHttpRequest =
      function BlockedXHR() {
        calls.push('XMLHttpRequest');
        throw new Error('XHR blocked by zero-network guard (I9)');
      };
  }

  return {
    calls,
    uninstall: () => {
      globalThis.fetch = prevFetch;
      if (prevXhr !== undefined)
        (globalThis as { XMLHttpRequest: unknown }).XMLHttpRequest = prevXhr;
    },
  };
}
