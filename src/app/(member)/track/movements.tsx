import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { BackLink } from '@/components/BackLink';
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
        <BackLink label="Track" fallbackHref="/track" />
        <View className="gap-2">
          <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
            Movement Library
          </Text>
          <Text className="text-gray-500 dark:text-gray-400 text-sm">
            Search every movement we track — across CrossFit and Hyrox — star
            your favourites, and open any one for your PRs and history.
          </Text>
        </View>

        <View className="flex-row items-center gap-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-xl px-3">
          <Ionicons name="search" size={18} color={colors.iconSecondary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search movements"
            placeholderTextColor={colors.iconSecondary}
            autoCorrect={false}
            className="flex-1 py-3 text-gray-900 dark:text-gray-50"
          />
          {searching ? (
            <Pressable onPress={() => setQuery('')} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color={colors.iconSecondary} />
            </Pressable>
          ) : null}
        </View>

        {searching ? (
          hits.length === 0 ? (
            <Text className="text-gray-500 dark:text-gray-400 text-sm">
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
  const anyStarred = starredCount > 0;
  return (
    <View
      className={
        open ? 'gap-2 rounded-2xl bg-primary/5 dark:bg-primary/10 p-2' : 'gap-2'
      }>
      <Pressable
        onPress={onToggleOpen}
        className={`flex-row items-center gap-3 bg-white dark:bg-gray-900 border rounded-xl px-4 py-3 active:opacity-70 ${
          open
            ? 'border-primary/50'
            : 'border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700'
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
          <Text className="text-gray-900 dark:text-gray-50 font-semibold">
            {group.name}
          </Text>
          <Text className="text-gray-500 dark:text-gray-400 text-xs">
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
            color={anyStarred ? '#F59E0B' : '#9CA3AF'}
          />
        </Pressable>
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={18}
          color="#9CA3AF"
        />
      </Pressable>
      {open ? (
        <View className="gap-2">
          {starredCount >= 2 ? (
            <View className="flex-row items-center gap-2 px-1">
              <Text className="text-gray-400 dark:text-gray-500 text-xs">
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
                        ? 'border-primary bg-primary/10'
                        : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/60'
                    }`}>
                    <Text
                      className={`text-xs font-medium ${
                        active
                          ? 'text-primary'
                          : 'text-gray-500 dark:text-gray-400'
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
  return (
    <Pressable
      onPress={() => router.push(`/track/movement/${movement.key}` as never)}
      className="flex-row items-center gap-3 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl px-4 py-3 hover:border-gray-300 dark:hover:border-gray-700 active:opacity-70">
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
        <Text className="text-gray-900 dark:text-gray-50 font-medium">
          {movement.name}
        </Text>
        <Text className="text-gray-400 dark:text-gray-500 text-xs">
          {group.name}
        </Text>
      </View>
      <Pressable
        onPress={onToggle}
        hitSlop={10}
        accessibilityLabel={starred ? 'Unstar movement' : 'Star movement'}
        className="hover:opacity-80 active:opacity-60">
        <Ionicons
          name={starred ? 'star' : 'star-outline'}
          size={20}
          color={starred ? '#F59E0B' : '#9CA3AF'}
        />
      </Pressable>
      <Ionicons name="chevron-forward" size={16} color="#9CA3AF" />
    </Pressable>
  );
}
