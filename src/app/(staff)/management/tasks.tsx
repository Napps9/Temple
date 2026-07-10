import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { DatePicker } from '@/components/DatePicker';
import { Input } from '@/components/Input';
import { Screen } from '@/components/Screen';
import { BackLink } from '@/components/BackLink';
import { useGymMembership, useRole, useSession } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useCan } from '@/lib/useCan';

type TaskRow = {
  id: string;
  assigned_to: string;
  status: 'open' | 'done' | 'cancelled';
  due_date: string | null;
  title: string;
  notes: string | null;
  completed_at: string | null;
  created_at: string;
  assignee: { full_name: string | null } | null;
};

type StaffMember = {
  profile_id: string;
  role: 'owner' | 'admin' | 'coach' | 'staff' | 'member';
  profiles: { full_name: string | null } | null;
};

export default function TasksScreen() {
  const role = useRole();
  const session = useSession();
  const { data: membership } = useGymMembership();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<'open' | 'done'>('open');
  const [assigneeFilter, setAssigneeFilter] = useState<string | 'all'>(
    role === 'staff' ? (session?.user.id ?? 'all') : 'all',
  );

  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [assignTo, setAssignTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canManage = useCan('can_manage_tasks') ?? false;

  const tasksQuery = useQuery({
    queryKey: ['coach-tasks', membership?.gymId, filter, assigneeFilter],
    enabled: !!membership?.gymId,
    queryFn: async () => {
      let query = supabase
        .from('coach_tasks')
        .select(
          'id, assigned_to, status, due_date, title, notes, completed_at, created_at, assignee:profiles!assigned_to(full_name)',
        )
        .eq('gym_id', membership!.gymId)
        .eq('status', filter)
        .order('due_date', { ascending: true, nullsFirst: false });
      if (assigneeFilter !== 'all') {
        query = query.eq('assigned_to', assigneeFilter);
      }
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as unknown as TaskRow[];
    },
  });

  const staffQuery = useQuery({
    queryKey: ['gym-staff', membership?.gymId],
    enabled: !!membership?.gymId && canManage,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gym_memberships')
        .select('profile_id, role, profiles!profile_id(full_name)')
        .eq('gym_id', membership!.gymId)
        .in('role', ['owner', 'admin', 'coach', 'staff']);
      if (error) throw error;
      return (data ?? []) as unknown as StaffMember[];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!membership || !session?.user.id) throw new Error('No gym selected');
      if (!assignTo) throw new Error('Choose an assignee');
      if (title.trim().length === 0) throw new Error('Title is required');
      const due = dueDate.trim().length > 0 ? dueDate.trim() : null;
      const { error } = await supabase.from('coach_tasks').insert({
        gym_id: membership.gymId,
        assigned_to: assignTo,
        created_by: session.user.id,
        title: title.trim(),
        notes: notes.trim().length > 0 ? notes.trim() : null,
        due_date: due,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setTitle('');
      setNotes('');
      setDueDate('');
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['coach-tasks'] });
    },
    onError: (e) => setError(errorMessage(e, 'Could not create task')),
  });

  const toggle = useMutation({
    mutationFn: async ({
      taskId,
      next,
    }: {
      taskId: string;
      next: 'open' | 'done';
    }) => {
      const fn = next === 'done' ? 'complete_task' : 'reopen_task';
      const { error } = await supabase.rpc(fn, { p_task_id: taskId });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['coach-tasks'] });
    },
    onError: (e) => setError(errorMessage(e, 'Could not update task')),
  });

  const assignees = useMemo(() => staffQuery.data ?? [], [staffQuery.data]);

  if (role && !canManage && role !== 'staff') {
    return <Redirect href="/management" />;
  }

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-4 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <BackLink label="Manage" fallbackHref="/management" />
        <View className="gap-2">
          <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
            Tasks
          </Text>
          <Text className="text-gray-500 dark:text-gray-400">
            {canManage
              ? 'Day-to-day work assigned across your team.'
              : 'Tasks assigned to you. Tap a task to mark it done.'}
          </Text>
        </View>

        <View className="flex-row gap-2">
          <Tab label="Open" active={filter === 'open'} onPress={() => setFilter('open')} />
          <Tab label="Done" active={filter === 'done'} onPress={() => setFilter('done')} />
        </View>

        {canManage ? (
          <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3 shadow-card">
            <Text className="text-gray-900 dark:text-gray-50 font-semibold">
              New task
            </Text>
            <Input
              label="Title"
              value={title}
              onChangeText={setTitle}
              placeholder="e.g. Follow up with new joiners"
            />
            <Input
              label="Notes (optional)"
              value={notes}
              onChangeText={setNotes}
              placeholder=""
              multiline
            />
            <DatePicker
              label="Due date (optional)"
              value={dueDate}
              onChange={setDueDate}
            />
            <View className="gap-2">
              <Text className="text-gray-700 dark:text-gray-200 text-sm font-medium">
                Assign to
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {assignees.map((a) => (
                  <Pressable
                    key={a.profile_id}
                    onPress={() => setAssignTo(a.profile_id)}
                    className={`px-3 py-1.5 rounded-full border ${
                      assignTo === a.profile_id
                        ? 'border-primary bg-primary/10'
                        : 'border-gray-200 dark:border-gray-700'
                    }`}>
                    <Text
                      className={
                        assignTo === a.profile_id
                          ? 'text-primary text-sm'
                          : 'text-gray-500 dark:text-gray-400 text-sm'
                      }>
                      {a.profiles?.full_name ?? a.role}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
            {error ? (
              <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
            ) : null}
            <Button onPress={() => create.mutate()} loading={create.isPending}>
              Create task
            </Button>
          </View>
        ) : null}

        {canManage && assignees.length > 0 ? (
          <View className="flex-row gap-2 flex-wrap">
            <Tab
              label="All assignees"
              active={assigneeFilter === 'all'}
              onPress={() => setAssigneeFilter('all')}
            />
            {assignees.map((a) => (
              <Tab
                key={a.profile_id}
                label={a.profiles?.full_name ?? a.role}
                active={assigneeFilter === a.profile_id}
                onPress={() => setAssigneeFilter(a.profile_id)}
              />
            ))}
          </View>
        ) : null}

        <View className="gap-2">
          {tasksQuery.isLoading ? (
            <Text className="text-gray-500 dark:text-gray-400">Loading…</Text>
          ) : (tasksQuery.data ?? []).length === 0 ? (
            <Text className="text-gray-500 dark:text-gray-400 text-sm">
              No tasks here.
            </Text>
          ) : (
            (tasksQuery.data ?? []).map((t) => (
              <Pressable
                key={t.id}
                onPress={() =>
                  toggle.mutate({
                    taskId: t.id,
                    next: t.status === 'open' ? 'done' : 'open',
                  })
                }
                className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-1 shadow-card">
                <View className="flex-row items-center gap-2">
                  <View
                    className={`w-5 h-5 rounded border ${
                      t.status === 'done'
                        ? 'bg-primary border-primary'
                        : 'border-gray-300 dark:border-gray-600'
                    }`}>
                    {t.status === 'done' ? (
                      <Text className="text-white text-center text-xs leading-5">✓</Text>
                    ) : null}
                  </View>
                  <Text className={`flex-1 ${
                      t.status === 'done'
                        ? 'text-gray-400 dark:text-gray-500 line-through'
                        : 'text-gray-900 dark:text-gray-50'
                    }`} numberOfLines={1}>
                    {t.title}
                  </Text>
                  {t.due_date ? (
                    <Text className="text-gray-500 dark:text-gray-400 text-xs">
                      {t.due_date}
                    </Text>
                  ) : null}
                </View>
                {t.notes ? (
                  <Text className="text-gray-500 dark:text-gray-400 text-xs">
                    {t.notes}
                  </Text>
                ) : null}
                <Text className="text-gray-400 dark:text-gray-500 text-[10px]">
                  {t.assignee?.full_name ?? 'Unassigned'}
                </Text>
              </Pressable>
            ))
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}

function Tab({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`px-3 py-1 rounded-full border ${
        active
          ? 'border-primary bg-primary/10'
          : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900'
      }`}>
      <Text
        className={
          active ? 'text-primary text-sm' : 'text-gray-500 dark:text-gray-400 text-sm'
        }>
        {label}
      </Text>
    </Pressable>
  );
}
