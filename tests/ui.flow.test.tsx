// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PrivRedactView from '../src/views/PrivRedactView';
import type { PortsFactory } from '../src/components/types';
import type { DocOption } from '../src/components/RedactView';
import { MockFlowPorts, type MockFlowOptions } from '../src/test/mock-flow';
import invoice from './fixtures/documents/invoice.json';

const INVOICE: DocOption = {
  id: 'invoice',
  label: 'Invoice',
  text: invoice.text,
  spans: invoice.plantedPii.map((p: { span: string }) => p.span),
};

function makeFactory(opts?: MockFlowOptions): {
  factory: PortsFactory;
  instances: MockFlowPorts[];
} {
  const instances: MockFlowPorts[] = [];
  const factory: PortsFactory = (mode) => {
    const p = new MockFlowPorts(mode, opts);
    instances.push(p);
    return p;
  };
  return { factory, instances };
}

const revoked: string[] = [];
let urlCounter = 0;

// Vitest runs without globals here, so RTL auto-cleanup never registers;
// unmount explicitly between tests.
afterEach(() => cleanup());

beforeEach(() => {
  revoked.length = 0;
  urlCounter = 0;
  URL.createObjectURL = vi.fn(() => `blob:mock-${++urlCounter}`);
  URL.revokeObjectURL = vi.fn((u: string) => {
    revoked.push(u);
  });
  sessionStorage.clear();
});

async function enableAndPickFixture(
  factory: PortsFactory,
  probe: () => Promise<'available'> = async () => 'available',
) {
  const user = userEvent.setup();
  render(
    <PrivRedactView factory={factory} probeFn={probe} fixtures={[INVOICE]} />,
  );
  await user.click(await screen.findByText('Enable on-device AI'));
  await screen.findByText('Redact PII');
  await user.click(screen.getByText('Invoice'));
  await screen.findByAltText('document');
  return user;
}

describe('badges / fallback / error / offline states', () => {
  it('on-device flow renders ON_DEVICE badges', async () => {
    const { factory } = makeFactory();
    const user = await enableAndPickFixture(factory);
    await user.click(screen.getByText('Redact PII'));
    await screen.findByTestId('redacted-text');
    await screen.findByText('Acme Paper Co');
    expect(screen.getByTestId('badge-redact')).toHaveProperty(
      'dataset.source',
      'ON_DEVICE',
    );
    expect(screen.getByTestId('badge-summary')).toHaveProperty(
      'dataset.source',
      'ON_DEVICE',
    );
    expect(screen.getAllByText('PREFER_ON_DEVICE').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/\d+ms/).length).toBe(2);
  });

  it('device-down PREFER flow falls back to IN_CLOUD with fallback marker', async () => {
    const { factory } = makeFactory({ world: { deviceAvailable: false } });
    const user = await enableAndPickFixture(factory);
    await user.click(screen.getByText('Redact PII'));
    await screen.findByTestId('redacted-text');
    expect(screen.getByTestId('badge-redact')).toHaveProperty(
      'dataset.source',
      'IN_CLOUD',
    );
    expect(screen.getAllByText('fallback').length).toBeGreaterThan(0);
  });

  it('ONLY_ON_DEVICE + unavailable shows the error copy', async () => {
    const { factory } = makeFactory({
      world: { deviceAvailable: false, deviceDownloading: false },
    });
    const user = userEvent.setup();
    render(
      <PrivRedactView
        factory={factory}
        probeFn={async () => 'available'}
        fixtures={[INVOICE]}
      />,
    );
    await user.click(await screen.findByText('Enable on-device AI'));
    await screen.findByText('Redact PII');
    await user.click(screen.getByLabelText('ONLY_ON_DEVICE'));
    await user.click(await screen.findByText('Enable on-device AI'));
    await screen.findByText('Redact PII');
    await user.click(screen.getByText('Invoice'));
    await screen.findByAltText('document');
    await user.click(screen.getByText('Redact PII'));
    await screen.findByText(/unavailable/i);
  });

  it('offline + device down shows the named offline error', async () => {
    const { factory } = makeFactory({
      world: { online: false, deviceAvailable: false },
    });
    const user = await enableAndPickFixture(factory);
    await user.click(screen.getByText('Redact PII'));
    await screen.findByText(/offline/i);
  });
});

describe('summary integrity + retry', () => {
  it('summary args contain zero raw PII fixture spans', async () => {
    const { factory, instances } = makeFactory();
    const user = await enableAndPickFixture(factory);
    await user.click(screen.getByText('Redact PII'));
    await screen.findByText('Acme Paper Co');
    expect(instances).toHaveLength(1);
    const arg = instances[0]!.summarizeCalls[0]!;
    for (const span of INVOICE.spans) expect(arg).not.toContain(span);
    expect(arg).toContain('███');
  });

  it('retry reuses byte-identical redacted text', async () => {
    const { factory, instances } = makeFactory({ summaryFailuresLeft: 1 });
    const user = await enableAndPickFixture(factory);
    await user.click(screen.getByText('Redact PII'));
    await screen.findByText('Retry summary');
    await user.click(screen.getByText('Retry summary'));
    await screen.findByText('Acme Paper Co');
    const calls = instances[0]!.summarizeCalls;
    expect(calls).toHaveLength(2);
    expect(calls[0]).toBe(calls[1]);
  });

  it('summary failure preserves redaction with a distinct error', async () => {
    const { factory } = makeFactory({ summaryFailuresLeft: 5 });
    const user = await enableAndPickFixture(factory);
    await user.click(screen.getByText('Redact PII'));
    const err = await screen.findByText('Summary failed (injected).');
    const redacted = screen.getByTestId('redacted-text');
    expect(redacted.textContent).not.toBe(err.textContent);
    expect(redacted.textContent).toContain('███');
  });
});

describe('image blur + reveal', () => {
  it('blurs by default and reveals only while held', async () => {
    const { factory } = makeFactory();
    await enableAndPickFixture(factory);
    const img = screen.getByAltText('document') as HTMLImageElement;
    expect(img.style.filter).toBe('blur(12px)');
    fireEvent.pointerDown(screen.getByText('Reveal'));
    expect(img.style.filter).toBe('none');
    fireEvent.pointerUp(screen.getByText('Reveal'));
    expect(img.style.filter).toBe('blur(12px)');
  });
});

describe('probe notice + gesture rule', () => {
  it('absent on-device support renders the cloud-only notice', async () => {
    const { factory } = makeFactory();
    render(
      <PrivRedactView
        factory={factory}
        probeFn={async () => 'unsupported'}
        fixtures={[INVOICE]}
      />,
    );
    await screen.findByText(/cloud-only/);
    expect(screen.getByText(/Chrome Desktop/)).toBeDefined();
    expect(screen.getByText(/139/)).toBeDefined();
  });

  it('mount without gesture makes zero init calls', async () => {
    const { factory, instances } = makeFactory();
    render(
      <PrivRedactView
        factory={factory}
        probeFn={async () => 'available'}
        fixtures={[INVOICE]}
      />,
    );
    await screen.findByText('Enable on-device AI');
    expect(instances).toHaveLength(1);
    expect(instances[0]!.port.initCalls).toBe(0);
  });

  it('resume label appears when a previous init started', async () => {
    sessionStorage.setItem('hl-init-started', '1');
    const { factory } = makeFactory();
    render(
      <PrivRedactView
        factory={factory}
        probeFn={async () => 'available'}
        fixtures={[INVOICE]}
      />,
    );
    await screen.findByText('Resume download');
  });

  it('cancel during init returns to idle and ignores late success', async () => {
    const { factory, instances } = makeFactory({ slowInit: true });
    const user = userEvent.setup();
    render(
      <PrivRedactView
        factory={factory}
        probeFn={async () => 'available'}
        fixtures={[INVOICE]}
      />,
    );
    await user.click(await screen.findByText('Enable on-device AI'));
    await screen.findByText('Cancel');
    await user.click(screen.getByText('Cancel'));
    await screen.findByText('Resume download');
    instances[0]!.releaseSlowInit();
    await waitFor(() =>
      expect(screen.queryByText('Redact PII')).toBeNull(),
    );
  });

  it('mode switch resets init and clears the dashboard', async () => {
    const { factory } = makeFactory();
    const user = await enableAndPickFixture(factory);
    await user.click(screen.getByText('Redact PII'));
    await screen.findByTestId('redacted-text');
    await user.click(screen.getByLabelText('ONLY_IN_CLOUD'));
    await screen.findByText('Enable on-device AI');
    expect(screen.queryByTestId('badge-redact')).toBeNull();
  });
});

describe('manual taps invalidate the summary (I1)', () => {
  it('tapped words are covered by the re-run summary', async () => {
    const { factory, instances } = makeFactory();
    const user = await enableAndPickFixture(factory);
    await user.click(screen.getByText('Redact PII'));
    await screen.findByText('Acme Paper Co');
    await user.click(screen.getByText('Acme', { selector: 'button' }));
    await user.click(await screen.findByText('Run summary'));
    await screen.findByText('Acme Paper Co');
    const calls = instances[0]!.summarizeCalls;
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain('Acme'); // first run predates the tap
    expect(calls[1]).not.toContain('Acme');
  });
});

describe('unsupported browser terminal state (I3)', () => {
  it('shows unavailable copy with no init loop', async () => {
    const { factory } = makeFactory();
    render(
      <PrivRedactView
        factory={factory}
        probeFn={async () => 'unsupported'}
        fixtures={[INVOICE]}
      />,
    );
    await screen.findByText(/Redaction is unavailable/);
    expect(screen.queryByText('Enable on-device AI')).toBeNull();
    expect(screen.queryByText('Redact PII')).toBeNull();
  });
});

describe('init progress + timeout UI (T8)', () => {
  it('shows download progress while init is pending', async () => {
    const { factory } = makeFactory({ slowInit: true });
    const user = userEvent.setup();
    render(
      <PrivRedactView
        factory={factory}
        probeFn={async () => 'available'}
        fixtures={[INVOICE]}
      />,
    );
    await user.click(await screen.findByText('Enable on-device AI'));
    await screen.findByText('Cancel');
    expect(screen.getByText(/Downloading on-device model/)).toBeDefined();
    expect(screen.getByText(/0%/)).toBeDefined();
  });

  it('hanging init surfaces the timeout copy', async () => {
    const { factory } = makeFactory({
      faults: { hangInit: true },
      timeoutMs: 50,
    });
    const user = userEvent.setup();
    render(
      <PrivRedactView
        factory={factory}
        probeFn={async () => 'available'}
        fixtures={[INVOICE]}
      />,
    );
    await user.click(await screen.findByText('Enable on-device AI'));
    await screen.findByText(/still downloading/);
    expect(screen.getByText(/Cancel/)).toBeDefined();
  });
});

describe('tap-to-redact recompute (Phase 4)', () => {
  it('tapping a missed word redacts it in the displayed output', async () => {
    const { factory } = makeFactory();
    const user = await enableAndPickFixture(factory);
    await user.click(screen.getByText('Redact PII'));
    const out = await screen.findByTestId('redacted-text');
    expect(out.textContent).toContain('Acme');
    await user.click(screen.getByText('Acme', { selector: 'button' }));
    expect(screen.getByTestId('redacted-text').textContent).not.toContain(
      'Acme',
    );
  });
});

describe('object URL lifecycle', () => {
  it('revokes on new upload and on unmount', async () => {
    const { factory } = makeFactory();
    const user = userEvent.setup();
    const { unmount } = render(
      <PrivRedactView
        factory={factory}
        probeFn={async () => 'available'}
        fixtures={[INVOICE]}
      />,
    );
    await user.click(await screen.findByText('Enable on-device AI'));
    await screen.findByText('Redact PII');
    const input = screen.getByLabelText(
      'Upload document photo',
    ) as HTMLInputElement;
    await user.upload(input, new File(['a'], 'a.png', { type: 'image/png' }));
    await screen.findByAltText('document');
    await user.upload(input, new File(['b'], 'b.png', { type: 'image/png' }));
    expect(revoked).toEqual(['blob:mock-1']);
    unmount();
    expect(revoked).toEqual(['blob:mock-1', 'blob:mock-2']);
  });
});
