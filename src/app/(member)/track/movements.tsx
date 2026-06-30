import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { BackLink } from '@/components/BackLink';
import { Screen } from '@/components/Screen';
import {
  allGroupsDisciplineFirst,
  catalogGroups,
  findMovement,
  searchMovements,
  type Movement,
  type MovementGroup,
} from '@/lib/movements';
import { useThemeColors } from '@/lib/theme';
import { useGymDiscipline } from '@/lib/useGymDiscipline';
import {
  useFavouriteMovements,
  useToggleFavouriteMovement,
} from '@/lib/useFavouriteMovements';

type IoniconName = keyof typeof Ionicons.glyphMap;

// Movement Library — search and browse the full cross-discipline catalog
// (not just the gym's flavour), star the movements you care about, and
// jump into any movement's detail / history. The home grid stays focused
// on the gym's discipline; this is the "everything" surface.
export default function MovementLibrary() {
  const colors = useThemeColors();
  const discipline = useGymDiscipline();
  const favourites = useFavouriteMovements();
  const toggleFavourite = useToggleFavouriteMovement();
  const [query, setQuery] = useState('');

  const groups = useMemo(
    () => allGroupsDisciplineFirst(discipline),
    [discipline],
  );
  // The gym's own discipline groups start expanded; everything else is
  // collapsed so the browse view opens focused.
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(catalogGroups(discipline).map((g) => g.key)),
  );

  const hits = useMemo(() => searchMovements(query), [query]);
  const searching = query.trim().length > 0;

  const starred = favourites.data ?? new Set<string>();
  const starredList = useMemo(
    () =>
      [...starred]
        .map((key) => findMovement(key))
        .filter((m): m is NonNullable<typeof m> => !!m),
    [starred],
  );

  const isStarred = (key: string) => starred.has(key);
  const onToggle = (key: string) =>
    toggleFavourite.mutate({ movementKey: key, on: !isStarred(key) });

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
            {starredList.length > 0 ? (
              <View className="gap-2">
                <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
                  Starred
                </Text>
                {starredList.map(({ group, movement }) => (
                  <MovementRow
                    key={movement.key}
                    movement={movement}
                    group={group}
                    starred
                    onToggle={() => onToggle(movement.key)}
                  />
                ))}
              </View>
            ) : null}

            {groups.map((g) => (
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
                isStarred={isStarred}
                onToggleStar={onToggle}
              />
            ))}
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
  isStarred,
  onToggleStar,
}: {
  group: MovementGroup;
  open: boolean;
  onToggleOpen: () => void;
  isStarred: (key: string) => boolean;
  onToggleStar: (key: string) => void;
}) {
  return (
    <View className="gap-2">
      <Pressable
        onPress={onToggleOpen}
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
          <Text className="text-gray-900 dark:text-gray-50 font-semibold">
            {group.name}
          </Text>
          <Text className="text-gray-500 dark:text-gray-400 text-xs">
            {group.movements.length}{' '}
            {group.movements.length === 1 ? 'movement' : 'movements'}
          </Text>
        </View>
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={18}
          color="#9CA3AF"
        />
      </Pressable>
      {open ? (
        <View className="gap-2">
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
