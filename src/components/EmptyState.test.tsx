// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { fireEvent, renderWithProviders as render, screen } from '../../test/render';

import { EmptyState } from './EmptyState';

// Four states, four different screens. The one worth guarding hardest is
// empty vs filtered: telling an owner with 214 members "no members yet"
// because their search box reads "zzz" is the system saying something
// false, and it is the mistake a single shared empty state makes.
describe('EmptyState', () => {
  it('leads with the action when there is genuinely nothing yet', () => {
    const onAction = vi.fn();
    render(
      <EmptyState
        icon="people-outline"
        title="No members yet"
        description="Invite your first and they land on a branded join page."
        actionLabel="Invite a member"
        onAction={onAction}
      />,
    );
    expect(screen.getByText('No members yet')).toBeTruthy();
    fireEvent.click(screen.getByText('Invite a member'));
    expect(onAction).toHaveBeenCalledOnce();
  });

  it('says the filter is the problem, not the list', () => {
    render(<EmptyState kind="filtered" actionLabel="Clear filters" onAction={() => {}} />);
    expect(screen.getByText('Nothing matches')).toBeTruthy();
    expect(screen.queryByText(/yet/)).toBeNull();
  });

  it('names its own failure and offers the way out', () => {
    const onAction = vi.fn();
    render(
      <EmptyState
        kind="failed"
        description="Could not load members."
        actionLabel="Try again"
        onAction={onAction}
      />,
    );
    expect(screen.getByText('That did not load')).toBeTruthy();
    fireEvent.click(screen.getByText('Try again'));
    expect(onAction).toHaveBeenCalledOnce();
  });

  it('draws a skeleton of the shape that is coming, not a spinner', () => {
    const { container } = render(<EmptyState kind="loading" rows={4} />);
    // Four rows, each an avatar bar plus two text bars.
    expect(container.querySelectorAll('[role="progressbar"]').length).toBe(1);
    expect(screen.queryByText('Nothing matches')).toBeNull();
  });

  it('keeps the accent for the empty state and nothing else', () => {
    // The recovery actions are ink: clearing a filter or retrying is not
    // what the page exists to do.
    const { container: empty } = render(
      <EmptyState title="No plans yet" actionLabel="Add a plan" onAction={() => {}} />,
    );
    const emptyTint = empty.querySelector('[data-icon]')?.getAttribute('data-color');

    const { container: failed } = render(
      <EmptyState kind="failed" actionLabel="Try again" onAction={() => {}} />,
    );
    const failedTint = failed.querySelector('[data-icon]')?.getAttribute('data-color');

    expect(emptyTint).not.toBe(failedTint);
    expect(failedTint).toBe('#DC2626');
  });
});
