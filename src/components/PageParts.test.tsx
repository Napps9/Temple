// @vitest-environment jsdom
import { Text, View } from 'react-native';
import { describe, expect, it, vi } from 'vitest';

import { fireEvent, renderWithProviders as render, screen } from '../../test/render';

import { AIMark } from './AIMark';
import { ListRow, RuledList } from './ListRow';
import { PageHead } from './PageHead';
import { SectionLabel } from './SectionLabel';
import { SettingCard } from './SettingCard';

// The six parts every screen is assembled from. jsdom cannot see any of
// their styling, so what these prove is the branching: what appears, what
// does not, and what a screen reader is told.
describe('PageHead', () => {
  it('says its title and subtitle', () => {
    render(<PageHead title="Members" subtitle="214 active · 3 lapsing" />);
    expect(screen.getByRole('heading', { name: 'Members' })).toBeTruthy();
    expect(screen.getByText('214 active · 3 lapsing')).toBeTruthy();
  });

  it('renders no subtitle line when there is no subtitle', () => {
    const { container } = render(<PageHead title="Track" />);
    expect(container.textContent).toBe('Track');
  });

  it('renders the one action it was given', () => {
    render(<PageHead title="Track" action={<Text>Record</Text>} />);
    expect(screen.getByText('Record')).toBeTruthy();
  });
});

describe('SectionLabel', () => {
  it('is a heading, so the group can be navigated to', () => {
    render(<SectionLabel>Waiting on you</SectionLabel>);
    expect(screen.getByRole('heading', { name: 'Waiting on you' })).toBeTruthy();
  });

  it('carries the group\u2019s own context on the right', () => {
    render(<SectionLabel right={<Text>5 classes</Text>}>Thursday</SectionLabel>);
    expect(screen.getByText('5 classes')).toBeTruthy();
  });
});

describe('ListRow', () => {
  it('says its title and subtitle', () => {
    render(<ListRow title="Amara Nwosu" subtitle="Trained 4× this week" />);
    expect(screen.getByText('Amara Nwosu')).toBeTruthy();
    expect(screen.getByText('Trained 4× this week')).toBeTruthy();
  });

  it('is not a button when it does nothing', () => {
    render(<ListRow title="Amara Nwosu" />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('is a button when it has somewhere to go, and names itself fully', () => {
    render(<ListRow title="Amara Nwosu" subtitle="Payment failed" onPress={() => {}} />);
    expect(
      screen.getByRole('button', { name: 'Amara Nwosu. Payment failed' }),
    ).toBeTruthy();
  });

  it('shows a chevron only when it is tappable', () => {
    const { container, rerender } = render(<ListRow title="Amara Nwosu" />);
    expect(container.querySelector('[data-icon="ionicons:chevron-forward"]')).toBeNull();
    rerender(<ListRow title="Amara Nwosu" onPress={() => {}} />);
    expect(
      container.querySelector('[data-icon="ionicons:chevron-forward"]'),
    ).toBeTruthy();
  });

  it('drops the chevron when the row has its own trailing action', () => {
    const { container } = render(
      <ListRow title="Bea Hollins" onPress={() => {}} trailing={<Text>Promote</Text>} />,
    );
    expect(screen.getByText('Promote')).toBeTruthy();
    expect(container.querySelector('[data-icon="ionicons:chevron-forward"]')).toBeNull();
  });

  it('calls back when pressed', () => {
    const onPress = vi.fn();
    render(<ListRow title="Amara Nwosu" onPress={onPress} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onPress).toHaveBeenCalledOnce();
  });

  it('keeps its lead and its chip', () => {
    render(
      <ListRow
        title="Marcus Bell"
        lead={<Text>MB</Text>}
        chip={<Text>Unlimited</Text>}
      />,
    );
    expect(screen.getByText('MB')).toBeTruthy();
    expect(screen.getByText('Unlimited')).toBeTruthy();
  });

  it('groups ruled rows inside one list', () => {
    render(
      <RuledList>
        <ListRow ruled first title="Amara Nwosu" />
        <ListRow ruled title="Marcus Bell" />
      </RuledList>,
    );
    expect(screen.getByText('Amara Nwosu')).toBeTruthy();
    expect(screen.getByText('Marcus Bell')).toBeTruthy();
  });
});

describe('SettingCard', () => {
  it('says its title and description', () => {
    render(
      <SettingCard
        title="Week starts on"
        description="Drives every calendar and every streak."
      />,
    );
    expect(screen.getByText('Week starts on')).toBeTruthy();
    expect(screen.getByText('Drives every calendar and every streak.')).toBeTruthy();
  });

  // The house rule: a card with no save is a card whose control commits on
  // toggle. It must not grow a button it does not need.
  it('renders no Save when the control saves itself', () => {
    render(<SettingCard title="Dark mode" control={<View />} />);
    expect(screen.queryByText('Save')).toBeNull();
  });

  it('renders its own Save when it has one, and calls back', () => {
    const onSave = vi.fn();
    render(<SettingCard title="Gym name" onSave={onSave} />);
    fireEvent.click(screen.getByText('Save'));
    expect(onSave).toHaveBeenCalledOnce();
  });

  it('takes the caller\u2019s word for the label', () => {
    render(<SettingCard title="Brand colour" onSave={() => {}} saveLabel="Apply" />);
    expect(screen.getByText('Apply')).toBeTruthy();
  });

  it('keeps the error inside the card that caused it', () => {
    render(
      <SettingCard
        title="Gym name"
        onSave={() => {}}
        error="That name is already taken."
      />,
    );
    expect(screen.getByText('That name is already taken.')).toBeTruthy();
  });

  it('hides the label while saving, so it cannot be pressed twice', () => {
    render(<SettingCard title="Gym name" onSave={() => {}} saving />);
    expect(screen.queryByText('Save')).toBeNull();
  });
});

describe('AIMark', () => {
  it('renders at any size without asking for a label', () => {
    // It is decorative: the sentence beside it already says who is
    // speaking, so a screen reader announcing "sparkle" would be noise.
    const { container } = render(<AIMark size={16} />);
    expect(container.querySelector('svg')).toBeTruthy();
    expect(container.textContent).toBe('');
  });

  it('takes a tile at avatar sizes and none below', () => {
    const small = render(<AIMark size={16} />);
    const large = render(<AIMark size={26} />);
    // The tile is a View wrapping the svg; bare is the svg alone.
    expect(small.container.firstElementChild?.tagName.toLowerCase()).toBe('svg');
    expect(large.container.firstElementChild?.tagName.toLowerCase()).toBe('div');
  });
});
