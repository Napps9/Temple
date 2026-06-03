import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { useGymMembership, useSession } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

type TrackedMetric = 'weight' | 'reps' | 'time' | 'distance' | 'calories' | 'rounds';

type Movement = {
  movement_id: string;
  name: string;
  category: string;
  tracked_metrics: TrackedMetric[];
  aliases: string[];
};

type Draft = {
  key: string;
  movement: Movement;
  metricKind: TrackedMetric;
  value: string;
  isRx: boolean;
};

const METRIC_PLACEHOLDER: Record<TrackedMetric, string> = {
  weight: 'kg',
  reps: 'reps',
  time: 'mm:ss',
  distance: 'm',
  calories: 'cal',
  rounds: 'rounds',
};

function parseValue(metric: TrackedMetric, raw: string):
  | { numeric: number | null; seconds: number | null; reps: number | null }
  | null {
  const v = raw.trim();
  if (!v) return null;
  if (metric === 'time') {
    const m = v.match(/^(\d+):(\d{1,2})$/);
    if (m) {
      const seconds = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
      return { numeric: null, seconds, reps: null };
    }
    const n = Number(v);
    if (Number.isFinite(n)) return { numeric: null, seconds: Math.round(n), reps: null };
    return null;
  }
  if (metric === 'reps') {
    const n = Number(v);
    return Number.isFinite(n) ? { numeric: null, seconds: null, reps: Math.round(n) } : null;
  }
  const n = Number(v);
  return Number.isFinite(n) ? { numeric: n, seconds: null, reps: null } : null;
}

export function LogWorkoutModal({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const session = useSession();
  const { data: gym } = useGymMembership();
  const queryClient = useQueryClient();

  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  const movementsQuery = useQuery({
    queryKey: ['movements'],
    enabled: visible,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('movements')
        .select('movement_id, name, category, tracked_metrics, aliases')
        .is('archived_at', null)
        .order('name');
      if (error) throw error;
      return data as unknown as Movement[];
    },
  });

  const candidates = useMemo(() => {
    const all = movementsQuery.data ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return all.slice(0, 12);
    return all
      .filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.aliases.some((a) => a.toLowerCase().includes(q)),
      )
      .slice(0, 12);
  }, [movementsQuery.data, search]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!session) throw new Error('Not signed in');
      if (drafts.length === 0) throw new Error('Add at least one movement');

      const { data: log, error: logErr } = await supabase
        .from('workout_logs')
        .insert({
          profile_id: session.user.id,
          gym_id: gym?.gymId ?? null,
          programmed_at: new Date().toISOString().slice(0, 10),
        })
        .select('log_id')
        .single();
      if (logErr) throw logErr;

      const rows = drafts.map((d, i) => {
        const parsed = parseValue(d.metricKind, d.value);
        if (!parsed) throw new Error(`Enter a value for ${d.movement.name}`);
        return {
          log_id: log.log_id,
          movement_id: d.movement.movement_id,
          metric_kind: d.metricKind,
          value_numeric: parsed.numeric,
          value_seconds: parsed.seconds,
          value_reps: parsed.reps,
          is_rx: d.isRx,
          ordinal: i,
        };
      });

      const { error: resErr } = await supabase
        .from('workout_log_results')
        .insert(rows);
      if (resErr) throw resErr;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workout-logs'] });
      setDrafts([]);
      setSearch('');
      setError(null);
      onClose();
    },
    onError: (err) => setError(errorMessage(err)),
  });

  function addDraft(m: Movement) {
    setDrafts((d) => [
      ...d,
      {
        key: `${m.movement_id}-${Date.now()}`,
        movement: m,
        metricKind: m.tracked_metrics[0],
        value: '',
        isRx: true,
      },
    ]);
    setSearch('');
  }

  function updateDraft(key: string, patch: Partial<Draft>) {
    setDrafts((d) => d.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  }

  function removeDraft(key: string) {
    setDrafts((d) => d.filter((x) => x.key !== key));
  }

  function handleClose() {
    if (saveMutation.isPending) return;
    setDrafts([]);
    setSearch('');
    setError(null);
    onClose();
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={handleClose} transparent>
      <View className="flex-1 bg-black/50 justify-end">
        <View className="bg-gray-50 dark:bg-gray-950 rounded-t-2xl max-h-[90%]">
          <View className="flex-row items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-800">
            <Text className="text-gray-900 dark:text-gray-50 text-lg font-semibold">
              Log a workout
            </Text>
            <Pressable onPress={handleClose} hitSlop={12}>
              <Ionicons name="close" size={24} color="#6B7280" />
            </Pressable>
          </View>

          <ScrollView contentContainerClassName="p-5 gap-4">
            {drafts.map((d) => (
              <View
                key={d.key}
                className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3">
                <View className="flex-row items-center justify-between">
                  <Text className="text-gray-900 dark:text-gray-50 font-semibold flex-1">
                    {d.movement.name}
                  </Text>
                  <Pressable onPress={() => removeDraft(d.key)} hitSlop={8}>
                    <Ionicons name="trash-outline" size={18} color="#EF4444" />
                  </Pressable>
                </View>
                {d.movement.tracked_metrics.length > 1 ? (
                  <View className="flex-row gap-2 flex-wrap">
                    {d.movement.tracked_metrics.map((mk) => (
                      <Pressable
                        key={mk}
                        onPress={() => updateDraft(d.key, { metricKind: mk })}
                        className={`px-3 py-1.5 rounded-full border ${
                          d.metricKind === mk
                            ? 'bg-primary border-primary'
                            : 'bg-transparent border-gray-300 dark:border-gray-700'
                        }`}>
                        <Text
                          className={`text-xs ${
                            d.metricKind === mk
                              ? 'text-white'
                              : 'text-gray-700 dark:text-gray-200'
                          }`}>
                          {mk}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
                <Input
                  label={`Result (${METRIC_PLACEHOLDER[d.metricKind]})`}
                  value={d.value}
                  onChangeText={(t) => updateDraft(d.key, { value: t })}
                  keyboardType={d.metricKind === 'time' ? 'default' : 'decimal-pad'}
                  placeholder={METRIC_PLACEHOLDER[d.metricKind]}
                />
                <Pressable
                  onPress={() => updateDraft(d.key, { isRx: !d.isRx })}
                  className="flex-row items-center gap-2">
                  <Ionicons
                    name={d.isRx ? 'checkbox' : 'square-outline'}
                    size={18}
                    color={d.isRx ? '#2563EB' : '#9CA3AF'}
                  />
                  <Text className="text-gray-700 dark:text-gray-200 text-sm">
                    As prescribed (Rx)
                  </Text>
                </Pressable>
              </View>
            ))}

            <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3">
              <Text className="text-gray-700 dark:text-gray-200 text-sm font-medium">
                Add a movement
              </Text>
              <TextInput
                className="bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-3 text-gray-900 dark:text-gray-50 text-base"
                placeholder="Search e.g. back squat, thruster"
                placeholderTextColor="#9CA3AF"
                value={search}
                onChangeText={setSearch}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <View className="gap-1">
                {candidates.map((m) => (
                  <Pressable
                    key={m.movement_id}
                    onPress={() => addDraft(m)}
                    className="px-3 py-2 rounded-lg active:bg-gray-100 dark:active:bg-gray-800">
                    <Text className="text-gray-900 dark:text-gray-50">{m.name}</Text>
                    <Text className="text-gray-500 dark:text-gray-400 text-xs">
                      {m.category} · {m.tracked_metrics.join(', ')}
                    </Text>
                  </Pressable>
                ))}
                {!movementsQuery.isLoading && candidates.length === 0 ? (
                  <Text className="text-gray-500 dark:text-gray-400 text-sm px-3 py-2">
                    No matches.
                  </Text>
                ) : null}
              </View>
            </View>

            {error ? (
              <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
            ) : null}

            <View className="flex-row gap-3 pt-2">
              <View className="flex-1">
                <Button variant="secondary" onPress={handleClose}>
                  Cancel
                </Button>
              </View>
              <View className="flex-1">
                <Button
                  onPress={() => saveMutation.mutate()}
                  loading={saveMutation.isPending}
                  disabled={drafts.length === 0}>
                  Save log
                </Button>
              </View>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
