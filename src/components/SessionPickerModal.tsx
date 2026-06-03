import { useQuery } from '@tanstack/react-query';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useEffect, useState } from 'react';

import { Button } from '@/components/Button';
import { useSession } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

type SessionRow = {
  id: string;
  name: string;
  starts_at: string;
  duration_minutes: number;
  class_types: { name: string; color: string } | null;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  onConfirm: (sessionIds: string[]) => void;
  confirmLabel?: string;
  pending?: boolean;
};

export function SessionPickerModal({
  visible,
  onClose,
  onConfirm,
  confirmLabel = 'Request cover',
  pending,
}: Props) {
  const session = useSession();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!visible) setSelected(new Set());
  }, [visible]);

  const sessionsQuery = useQuery({
    queryKey: ['my-upcoming-sessions', session?.user.id],
    enabled: !!session?.user.id && visible,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('class_sessions')
        .select('id, name, starts_at, duration_minutes, class_types(name, color)')
        .eq('coach_id', session!.user.id)
        .gte('starts_at', new Date().toISOString())
        .order('starts_at', { ascending: true })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as SessionRow[];
    },
  });

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const close = () => {
    setSelected(new Set());
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <Pressable
        onPress={close}
        className="flex-1 bg-black/60 items-center justify-center px-6">
        <Pressable
          onPress={() => {}}
          className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-6 w-full max-w-md gap-4">
          <Text className="text-gray-900 dark:text-gray-50 text-lg font-semibold">
            Pick classes you need covered
          </Text>
          <Text className="text-gray-500 dark:text-gray-400 text-sm">
            Showing your upcoming classes. Pick one or more — coaches at this
            gym will see and claim them.
          </Text>

          <ScrollView className="max-h-72">
            {sessionsQuery.isLoading ? (
              <Text className="text-gray-500 dark:text-gray-400 text-sm">
                Loading…
              </Text>
            ) : sessionsQuery.error ? (
              <Text className="text-red-500 dark:text-red-400 text-sm">
                {errorMessage(sessionsQuery.error, 'Could not load sessions')}
              </Text>
            ) : (sessionsQuery.data ?? []).length === 0 ? (
              <Text className="text-gray-500 dark:text-gray-400 text-sm">
                You have no upcoming sessions.
              </Text>
            ) : (
              <View className="gap-2">
                {(sessionsQuery.data ?? []).map((s) => {
                  const checked = selected.has(s.id);
                  const start = new Date(s.starts_at);
                  return (
                    <Pressable
                      key={s.id}
                      onPress={() => toggle(s.id)}
                      className="flex-row items-center gap-3 p-2 rounded-lg">
                      <View
                        className={`w-5 h-5 rounded border ${
                          checked
                            ? 'bg-primary border-primary'
                            : 'border-gray-300 dark:border-gray-600'
                        }`}>
                        {checked ? (
                          <Text className="text-white text-center text-xs leading-5">✓</Text>
                        ) : null}
                      </View>
                      <View className="flex-1">
                        <Text className="text-gray-900 dark:text-gray-50">
                          {s.class_types?.name ?? s.name}
                        </Text>
                        <Text className="text-gray-500 dark:text-gray-400 text-xs">
                          {start.toLocaleDateString(undefined, {
                            weekday: 'short',
                            day: 'numeric',
                            month: 'short',
                          })}{' '}
                          at{' '}
                          {start.toLocaleTimeString(undefined, {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}{' '}
                          · {s.duration_minutes} min
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </ScrollView>

          <View className="flex-row gap-3">
            <View className="flex-1">
              <Button variant="secondary" onPress={close}>
                Cancel
              </Button>
            </View>
            <View className="flex-1">
              <Button
                onPress={() => onConfirm([...selected])}
                loading={pending}
                disabled={selected.size === 0}>
                {confirmLabel} ({selected.size})
              </Button>
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
