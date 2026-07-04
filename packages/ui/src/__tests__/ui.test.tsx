import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Spinner } from '../components/Spinner.js';
import { Toast, type ToastData } from '../components/Toast.js';
import { Autocomplete } from '../components/Autocomplete.js';
import { ResizableSidebar } from '../components/ResizableSidebar.js';

// Ensure DOM is cleaned between tests even without globals mode.
afterEach(() => { cleanup(); });

// jsdom doesn't implement scrollIntoView — stub it.
beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = () => undefined;
});

// ─── Spinner ──────────────────────────────────────────────────────────────────

describe('Spinner', () => {
  it('renders an SVG with role=status', () => {
    render(<Spinner />);
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('accepts size prop without error', () => {
    const { unmount } = render(<Spinner size="lg" />);
    unmount();
  });
});

// ─── Toast ────────────────────────────────────────────────────────────────────

describe('Toast', () => {
  it('renders the message', () => {
    const toast: ToastData = { id: '1', message: 'Hello world', variant: 'success' };
    render(<Toast toast={toast} onDismiss={() => undefined} />);
    expect(screen.getByText('Hello world')).toBeTruthy();
  });

  it('calls onDismiss when close button clicked', async () => {
    const user = userEvent.setup();
    let dismissed = false;
    const toast: ToastData = { id: '2', message: 'Bye', variant: 'info' };
    render(<Toast toast={toast} onDismiss={() => { dismissed = true; }} />);
    await user.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(dismissed).toBe(true);
  });
});

// ─── Autocomplete ─────────────────────────────────────────────────────────────

describe('Autocomplete', () => {
  const options = [
    { value: 'main', label: 'main' },
    { value: 'dev', label: 'develop' },
    { value: 'feat', label: 'feature/new-ui' },
  ];

  it('renders the trigger button', () => {
    render(<Autocomplete options={options} onChange={() => undefined} placeholder="Pick a branch" />);
    expect(screen.getByText('Pick a branch')).toBeTruthy();
  });

  it('opens dropdown and shows options on click', async () => {
    const user = userEvent.setup();
    render(<Autocomplete options={options} onChange={() => undefined} placeholder="Pick" />);
    await user.click(screen.getByRole('button'));
    expect(screen.getByRole('listbox')).toBeTruthy();
    expect(screen.getByText('main')).toBeTruthy();
    expect(screen.getByText('develop')).toBeTruthy();
  });

  it('calls onChange with selected value', async () => {
    const user = userEvent.setup();
    let selected: string | undefined;
    render(<Autocomplete options={options} onChange={v => { selected = v; }} placeholder="Pick" />);
    await user.click(screen.getByRole('button'));
    await user.click(screen.getByText('develop'));
    expect(selected).toBe('dev');
  });
});

// ─── ResizableSidebar ───────────────────────────────────────────────────────────

describe('ResizableSidebar', () => {
  it('renders children and is backward-compatible when collapsible/collapsed are omitted', () => {
    // This mirrors the home page's usage (app/src/renderer/routes/index.tsx),
    // which only passes initialWidth/minWidth/maxWidth — no collapse props at all.
    render(
      <ResizableSidebar initialWidth={240} minWidth={180} maxWidth={400}>
        <div>Home sidebar content</div>
      </ResizableSidebar>
    );
    expect(screen.getByText('Home sidebar content')).toBeTruthy();
    // Still resizable — the drag handle separator should be present.
    expect(screen.getByRole('separator', { name: /resize sidebar/i })).toBeTruthy();
  });

  it('does not collapse when collapsed=true but collapsible is not set', () => {
    // Guards against a future regression where `collapsed` alone (without
    // opting into `collapsible`) would unexpectedly hide children.
    render(
      <ResizableSidebar collapsed railContent={<div>Rail</div>}>
        <div>Children</div>
      </ResizableSidebar>
    );
    expect(screen.getByText('Children')).toBeTruthy();
    expect(screen.queryByText('Rail')).toBeNull();
  });

  it('renders children (not railContent) when collapsible but not collapsed', () => {
    render(
      <ResizableSidebar collapsible collapsed={false} railContent={<div>Rail</div>}>
        <div>Children</div>
      </ResizableSidebar>
    );
    expect(screen.getByText('Children')).toBeTruthy();
    expect(screen.queryByText('Rail')).toBeNull();
  });

  it('renders railContent (not children) when collapsible and collapsed', () => {
    render(
      <ResizableSidebar collapsible collapsed railContent={<div>Rail</div>}>
        <div>Children</div>
      </ResizableSidebar>
    );
    expect(screen.getByText('Rail')).toBeTruthy();
    expect(screen.queryByText('Children')).toBeNull();
  });

  it('falls back to rendering children when collapsed but no railContent is given', () => {
    render(
      <ResizableSidebar collapsible collapsed>
        <div>Children</div>
      </ResizableSidebar>
    );
    expect(screen.getByText('Children')).toBeTruthy();
  });

  it('hides the resize handle while collapsed', () => {
    render(
      <ResizableSidebar collapsible collapsed railContent={<div>Rail</div>}>
        <div>Children</div>
      </ResizableSidebar>
    );
    expect(screen.queryByRole('separator', { name: /resize sidebar/i })).toBeNull();
  });

  it('applies collapsedWidth to the container when collapsed', () => {
    const { container } = render(
      <ResizableSidebar collapsible collapsed collapsedWidth={64} railContent={<div>Rail</div>}>
        <div>Children</div>
      </ResizableSidebar>
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.width).toBe('64px');
    expect(root.getAttribute('data-collapsed')).toBe('true');
  });

  it('defaults collapsedWidth to 48px when not specified', () => {
    const { container } = render(
      <ResizableSidebar collapsible collapsed railContent={<div>Rail</div>}>
        <div>Children</div>
      </ResizableSidebar>
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.width).toBe('48px');
  });

  it('uses initialWidth (not collapsedWidth) when not collapsed', () => {
    const { container } = render(
      <ResizableSidebar collapsible collapsed={false} initialWidth={330} collapsedWidth={48}>
        <div>Children</div>
      </ResizableSidebar>
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.width).toBe('330px');
    expect(root.getAttribute('data-collapsed')).toBe('false');
  });
});
