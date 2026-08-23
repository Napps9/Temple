import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Text, TextInput } from '@/components/Text';

import { BackLink } from '@/components/BackLink';
import { PageHead } from '@/components/PageHead';
import { ListRow } from '@/components/ListRow';
import { SearchField } from '@/components/SearchField';
import { Screen } from '@/components/Screen';
import {
  allGroupsDisciplineFirst,
  searchMovements,
  type Movement,
  type MovementGroup,
} from '@/lib/movements';
import { useThemeColors } from '@/lib/theme';
import { useGymDiscipline } from '@/lib/useGymDiscipline';
import { useMovementFavourites } from '@/lib/useFavouriteMovements';

type IoniconName = keyof typeof Ionicons.glyphMap;

// Movement Library — search and browse the full cross-discipline catalog
// (not just the gym's flavour), star movements or whole groups, and jump
// into any movement's detail / history. What's starred here drives the
// Track home grid.
export default function MovementLibrary() {
  const colors = useThemeColors();
  const discipline = useGymDiscipline();
  const fav = useMovementFavourites(discipline);
  const [query, setQuery] = useState('');

  const groups = useMemo(
    () => allGroupsDisciplineFirst(discipline),
    [discipline],
  );
  // All groups start collapsed so the library opens as a scannable list of
  // groups; the member expands the ones they want.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const hits = useMemo(() => searchMovements(query), [query]);
  const searching = query.trim().length > 0;

  const isStarred = (key: string) => fav.movements.has(key);
  const onToggle = (key: string) => fav.toggleMovement(key, !isStarred(key));

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-4 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <BackLink fallbackHref="/track" />
        <PageHead
          title="Movement Library"
          subtitle="Search every movement we track — across CrossFit and Hyrox — star your favourites, and open any one for your PRs and history."
        />

        {/* The library's job is nearly always "find one movement", so
            the cursor starts in the search box — typing is tap zero. */}
        <SearchField
          value={query}
          onChangeText={setQuery}
          placeholder="Search movements"
          autoFocus
        />

        {searching ? (
          hits.length === 0 ? (
            <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
              No movements match “{query.trim()}”.
            </Text>
          ) : (
            <View className="gap-2">
              {hits.map(({ group, movement }) => (
                <MovementRow
                  key={movement.key}
                  movement={movement}
                  group={group}
                  starred={isStarred(movement.key)}
                  onToggle={() => onToggle(movement.key)}
                />
              ))}
            </View>
          )
        ) : (
          <>
            {groups.map((g) => {
              const starredCount = g.movements.filter((m) =>
                fav.movements.has(m.key),
              ).length;
              return (
                <GroupSection
                  key={g.key}
                  group={g}
                  open={expanded.has(g.key)}
                  onToggleOpen={() =>
                    setExpanded((cur) => {
                      const next = new Set(cur);
                      if (next.has(g.key)) next.delete(g.key);
                      else next.add(g.key);
                      return next;
                    })
                  }
                  grouped={fav.groups.has(g.key)}
                  starredCount={starredCount}
                  onToggleAll={() => fav.toggleGroup(g.key, starredCount === 0)}
                  onSetGrouped={(val) => fav.setGrouped(g.key, val)}
                  isStarred={isStarred}
                  onToggleStar={onToggle}
                />
              );
            })}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

function GroupSection({
  group,
  open,
  onToggleOpen,
  grouped,
  starredCount,
  onToggleAll,
  onSetGrouped,
  isStarred,
  onToggleStar,
}: {
  group: MovementGroup;
  open: boolean;
  onToggleOpen: () => void;
  grouped: boolean;
  starredCount: number;
  onToggleAll: () => void;
  onSetGrouped: (grouped: boolean) => void;
  isStarred: (key: string) => boolean;
  onToggleStar: (key: string) => void;
}) {
  const colors = useThemeColors();
  const anyStarred = starredCount > 0;
  return (
    <View
      className={
        open ? 'gap-2 rounded-card bg-raised dark:bg-raised-dk p-2' : 'gap-2'
      }>
      <Pressable
        onPress={onToggleOpen}
        className={`flex-row items-center gap-3 bg-surface dark:bg-surface-dk border rounded-ctl px-4 py-3 active:opacity-70 ${
          open
            ? 'border-line-strong dark:border-line-strong-dk'
            : 'border-line dark:border-line-dk hover:border-line-strong dark:hover:border-line-strong-dk'
        }`}>
        <View
          style={{ backgroundColor: `${group.accent}26` }}
          className="w-9 h-9 rounded-full items-center justify-center">
          <Ionicons
            name={group.icon as IoniconName}
            size={18}
            color={group.accent}
          />
        </View>
        <View className="flex-1">
          <Text className="text-ink dark:text-ink-dk font-semibold">
            {group.name}
          </Text>
          <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
            {anyStarred
              ? `${starredCount} of ${group.movements.length} starred${
                  starredCount >= 2 ? (grouped ? ' · grouped' : ' · separate') : ''
                }`
              : `${group.movements.length} ${
                  group.movements.length === 1 ? 'movement' : 'movements'
                }`}
          </Text>
        </View>
        <Pressable
          onPress={onToggleAll}
          hitSlop={10}
          accessibilityLabel={
            anyStarred ? 'Unstar whole group' : 'Star whole group'
          }
          className="hover:opacity-80 active:opacity-60">
          <Ionicons
            name={anyStarred ? 'star' : 'star-outline'}
            size={20}
            color={anyStarred ? '#F59E0B' : colors.ink3}
          />
        </Pressable>
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={colors.ink3}
        />
      </Pressable>
      {open ? (
        <View className="gap-2">
          {starredCount >= 2 ? (
            <View className="flex-row items-center gap-2 px-1">
              <Text className="text-ink-3 dark:text-ink-3-dk text-xs">
                Show as
              </Text>
              {(['grouped', 'separate'] as const).map((mode) => {
                const active = mode === (grouped ? 'grouped' : 'separate');
                return (
                  <Pressable
                    key={mode}
                    onPress={() => onSetGrouped(mode === 'grouped')}
                    className={`px-3 py-1 rounded-full border ${
                      active
                        ? 'border-transparent bg-raised dark:bg-raised-dk'
                        : 'border-line dark:border-line-dk hover:bg-raised dark:hover:bg-raised-dk/60'
                    }`}>
                    <Text
                      className={`text-xs font-medium ${
                        active
                          ? 'text-ink dark:text-ink-dk font-semibold'
                          : 'text-ink-2 dark:text-ink-2-dk'
                      }`}>
                      {mode === 'grouped' ? 'One group tile' : 'Separate tiles'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
          {group.movements.map((m) => (
            <MovementRow
              key={m.key}
              movement={m}
              group={group}
              starred={isStarred(m.key)}
              onToggle={() => onToggleStar(m.key)}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function MovementRow({
  movement,
  group,
  starred,
  onToggle,
}: {
  movement: Movement;
  group: MovementGroup;
  starred: boolean;
  onToggle: () => void;
}) {
  const colors = useThemeColors();
  return (
    <ListRow
      onPress={() => router.push(`/track/movement/${movement.key}` as never)}
      lead={
        <View
          style={{ backgroundColor: `${group.accent}26` }}
          className="w-9 h-9 rounded-full items-center justify-center">
          <Ionicons
            name={group.icon as IoniconName}
            size={18}
            color={group.accent}
          />
        </View>
      }
      title={movement.name}
      subtitle={group.name}
      trailing={
        <View className="flex-row items-center gap-2">
          <Pressable
            onPress={onToggle}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={starred ? 'Unstar movement' : 'Star movement'}>
            <Ionicons
              name={starred ? 'star' : 'star-outline'}
              size={18}
              color={starred ? '#F59E0B' : colors.ink3}
            />
          </Pressable>
          <Ionicons name="chevron-forward" size={15} color={colors.ink3} />
        </View>
      }
    />
  );
}
