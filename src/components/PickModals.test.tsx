// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { fireEvent, renderWithProviders as render, screen } from '../../test/render';

import { CancelClassDialog } from './CancelClassDialog';
import { Check } from './Check';
import { InviteQRModal } from './InviteQRModal';
import { MonthPickerModal } from './MonthPickerModal';
import { RemoveMemberDialog } from './RemoveMemberDialog';
import { SessionPickerModal } from './SessionPickerModal';

// The tick box that four modals used to each draw for themselves. What
// can be checked without layout is that the three states are three
// distinct renders and that only the ticked one carries a glyph.
describe('Check', () => {
  function box() {
    return document.body.firstElementChild!.firstElementChild!;
  }

  it('draws nothing inside it when off', () => {
    render(<Check on={false} />);
    expect(box().children.length).toBe(0);
  });

  it('draws a tick when on', () => {
    render(<Check on />);
    expect(box().children.length).toBe(1);
  });

  it('draws a bar, not a tick, when partial', () => {
    const { container } = render(<Check on={false} partial />);
    // The bar is a plain View; a tick is an SVG from the icon set.
    expect(container.querySelector('svg')).toBeNull();
    expect(box().children.length).toBe(1);
  });

  it('prefers the bar when a partial group is also marked on', () => {
    const { container } = render(<Check on partial />);
    expect(container.querySelector('svg')).toBeNull();
  });
});

// Every destructive modal follows the same rule: the title asks the
// question, the body carries the consequence, and the safe way out is
// named rather than called "Cancel". These are the two that were not
// already going through ConfirmDialog.
describe('destructive modals ask a question and name the safe option', () => {
  it('RemoveMemberDialog asks before it removes', () => {
    render(
      <RemoveMemberDialog
        visible
        gymId="g1"
        profileId="p1"
        memberName="Ana Ruiz"
        onClose={() => {}}
      />,
    );
    expect(screen.getByText('Remove Ana Ruiz from the gym?')).toBeTruthy();
    expect(screen.getByText('Keep them')).toBeTruthy();
    expect(screen.getByText('Remove')).toBeTruthy();
  });

  it('RemoveMemberDialog says what is lost and what survives', () => {
    render(
      <RemoveMemberDialog
        visible
        gymId="g1"
        profileId="p1"
        memberName="Ana Ruiz"
        onClose={() => {}}
      />,
    );
    expect(screen.getByText(/History is preserved/)).toBeTruthy();
  });

  it('CancelClassDialog asks before it cancels', () => {
    render(
      <CancelClassDialog
        visible
        sessionId="s1"
        recurrenceId={null}
        startsAt="2026-09-03T17:30:00.000Z"
        classTypeName="Metcon"
        durationMinutes={60}
        onClose={() => {}}
        onCancelled={() => {}}
      />,
    );
    expect(screen.getByText('Cancel Metcon?')).toBeTruthy();
    expect(screen.getByText('Keep it')).toBeTruthy();
  });

  it('CancelClassDialog offers no scope choice for a one-off class', () => {
    render(
      <CancelClassDialog
        visible
        sessionId="s1"
        recurrenceId={null}
        startsAt="2026-09-03T17:30:00.000Z"
        classTypeName="Metcon"
        durationMinutes={60}
        onClose={() => {}}
        onCancelled={() => {}}
      />,
    );
    expect(screen.queryByText('The whole series')).toBeNull();
  });

  it('CancelClassDialog offers all three scopes for a recurring one', () => {
    render(
      <CancelClassDialog
        visible
        sessionId="s1"
        recurrenceId="r1"
        startsAt="2026-09-03T17:30:00.000Z"
        classTypeName="Metcon"
        durationMinutes={60}
        onClose={() => {}}
        onCancelled={() => {}}
      />,
    );
    expect(screen.getByText('Just this one')).toBeTruthy();
    expect(screen.getByText('This and all future')).toBeTruthy();
    expect(screen.getByText('The whole series')).toBeTruthy();
  });
});

// The pickers all confirm with a count, and all refuse to confirm with
// nothing picked — the thing a caller relies on to not fire an empty RPC.
describe('pickers', () => {
  it('SessionPickerModal counts the selection in its confirm label', () => {
    render(
      <SessionPickerModal visible onClose={() => {}} onConfirm={() => {}} />,
    );
    expect(screen.getByText('Request cover (0)')).toBeTruthy();
  });

  it('SessionPickerModal takes the caller’s own confirm label', () => {
    render(
      <SessionPickerModal
        visible
        onClose={() => {}}
        onConfirm={() => {}}
        confirmLabel="Offer these"
      />,
    );
    expect(screen.getByText('Offer these (0)')).toBeTruthy();
  });

  it('MonthPickerModal names itself and steps through months', () => {
    const onChangeMonth = vi.fn();
    render(
      <MonthPickerModal
        visible
        month={new Date(2026, 8, 1)}
        selected={new Date(2026, 8, 3)}
        weekStartsOn="mon"
        onChangeMonth={onChangeMonth}
        onSelectDay={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText('Jump to a date')).toBeTruthy();
    expect(screen.getByText('September 2026')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Next month'));
    expect(onChangeMonth).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByLabelText('Previous month'));
    expect(onChangeMonth).toHaveBeenCalledWith(-1);
  });

  it('MonthPickerModal hands back the day that was tapped', () => {
    const onSelectDay = vi.fn();
    render(
      <MonthPickerModal
        visible
        month={new Date(2026, 8, 1)}
        selected={new Date(2026, 8, 3)}
        weekStartsOn="mon"
        onChangeMonth={() => {}}
        onSelectDay={onSelectDay}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByText('15'));
    expect(onSelectDay).toHaveBeenCalledOnce();
    const day = onSelectDay.mock.calls[0]![0] as Date;
    expect(day.getDate()).toBe(15);
    expect(day.getMonth()).toBe(8);
  });

  it('InviteQRModal shows the URL it is encoding', () => {
    render(
      <InviteQRModal
        visible
        onClose={() => {}}
        title="Join Southside"
        subtitle="Scan to sign up as a member"
        url="https://app.jointemple.io/j/southside"
      />,
    );
    expect(screen.getByText('Join Southside')).toBeTruthy();
    expect(screen.getByText('https://app.jointemple.io/j/southside')).toBeTruthy();
  });
});
