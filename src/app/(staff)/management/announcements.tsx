import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Screen } from '@/components/Screen';
import { useGymMembership, useSession } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

type Announcement = {
  announcement_id: string;
  title: string;
  body: string;
  pinned: boolean;
  published_at: string;
  expires_at: string | null;
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  });
}

export default function ManageAnnouncements() {
  const session = useSession();
  const { data: gym } = useGymMembership();
  const queryClient = useQueryClient();

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [pinned, setPinned] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: ['announcements-staff', gym?.gymId],
    enabled: !!gym?.gymId,
    queryFn: async (): Promise<Announcement[]> => {
      const { data, error } = await supabase
        .from('announcements')
        .select(
          'announcement_id, title, body, pinned, published_at, expires_at',
        )
        .eq('gym_id', gym!.gymId)
        .order('pinned', { ascending: false })
        .order('published_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as Announcement[];
    },
  });

  const publishMutation = useMutation({
    mutationFn: async () => {
      if (!session || !gym) throw new Error('Not ready');
      if (!title.trim() || !body.trim()) {
        throw new Error('Title and body required');
      }
      const { error } = await supabase.from('announcements').insert({
        gym_id: gym.gymId,
        title: title.trim(),
        body: body.trim(),
        pinned,
        created_by: session.user.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setTitle('');
      setBody('');
      setPinned(false);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['announcements-staff', gym?.gymId] });
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('announcements')
        .delete()
        .eq('announcement_id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['announcements-staff', gym?.gymId] });
    },
  });

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-4 py-6 md:max-w-2xl md:mx-auto md:w-full px-4">
        <View className="gap-1">
          <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
            Announcements
          </Text>
          <Text className="text-gray-500 dark:text-gray-400">
            Broadcast notices to members.
          </Text>
        </View>

        <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3">
          <Text className="text-gray-900 dark:text-gray-50 font-semibold">
            New announcement
          </Text>
          <Input
            label="Title"
            value={title}
            onChangeText={setTitle}
            autoCapitalize="sentences"
            placeholder="e.g. Closed Bank Holiday Monday"
          />
          <View className="gap-1.5">
            <Text className="text-gray-700 dark:text-gray-200 text-sm font-medium">
              Message
            </Text>
            <TextInput
              className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-3 text-gray-900 dark:text-gray-50 text-base"
              placeholderTextColor="#9CA3AF"
              value={body}
              onChangeText={setBody}
              multiline
              numberOfLines={4}
              style={{ minHeight: 100, textAlignVertical: 'top' }}
              placeholder="Details for members…"
            />
          </View>
          <Pressable
            onPress={() => setPinned(!pinned)}
            className="flex-row items-center gap-2">
            <Ionicons
              name={pinned ? 'checkbox' : 'square-outline'}
              size={18}
              color={pinned ? '#2563EB' : '#9CA3AF'}
            />
            <Text className="text-gray-700 dark:text-gray-200 text-sm">
              Pin to top
            </Text>
          </Pressable>
          {error ? (
            <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
          ) : null}
          <Button
            onPress={() => publishMutation.mutate()}
            loading={publishMutation.isPending}
            disabled={!title.trim() || !body.trim()}>
            Publish
          </Button>
        </View>

        <View className="gap-2">
          <Text className="text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wide">
            Published
          </Text>
          {listQuery.data?.length === 0 ? (
            <Text className="text-gray-500 dark:text-gray-400 text-sm">
              No announcements yet.
            </Text>
          ) : null}
          {listQuery.data?.map((a) => (
            <View
              key={a.announcement_id}
              className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-2">
              <View className="flex-row items-center gap-2">
                {a.pinned ? (
                  <Ionicons name="pin" size={14} color="#6B7280" />
                ) : null}
                <Text className="text-gray-900 dark:text-gray-50 font-semibold flex-1">
                  {a.title}
                </Text>
                <Text className="text-gray-500 dark:text-gray-400 text-xs">
                  {fmtDate(a.published_at)}
                </Text>
                <Pressable
                  onPress={() => deleteMutation.mutate(a.announcement_id)}
                  hitSlop={8}>
                  <Ionicons name="trash-outline" size={16} color="#EF4444" />
                </Pressable>
              </View>
              <Text className="text-gray-700 dark:text-gray-200 text-sm">
                {a.body}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </Screen>
  );
}
