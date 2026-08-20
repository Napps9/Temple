import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { Text } from '@/components/Text';

import { Avatar } from '@/components/Avatar';
import { BackLink } from '@/components/BackLink';
import { Button } from '@/components/Button';
import { Sheet, SheetAction } from '@/components/Sheet';
import { ChipButton } from '@/components/ChipButton';
import { Input } from '@/components/Input';
import {
  MemberProgrammingAccessModal,
  type MemberProgrammingAccessValue,
} from '@/components/MemberProgrammingAccessModal';
import { PageHead } from '@/components/PageHead';
import { ProgrammingCalendar } from '@/components/ProgrammingCalendar';
import { Screen } from '@/components/Screen';
import { useGymMembership, useSession } from '@/lib/auth';
import { formatDate } from '@/lib/format-date';
import { errorMessage } from '@/lib/errors';
import {
  MEMBER_PROGRAMMING_BUCKET,
  useMemberProgrammingFiles,
  useOpenProgrammingFile,
} from '@/lib/member-programming';
import { supabase } from '@/lib/supabase';
import { useThemeColors } from '@/lib/theme';
import { useCan } from '@/lib/useCan';

export default function MemberProgrammingScreen() {
  const allowed = useCan('can_program_members');
  const { profile } = useLocalSearchParams<{ profile?: string }>();
  if (allowed === false) {
    return <Redirect href="/management" />;
  }
  return profile ? (
    <MemberCalendar profileId={profile} />
  ) : (
    <IndividualsList />
  );
}

function MemberCalendar({ profileId }: { profileId: string }) {
  const { data: membership } = useGymMembership();
  const [accessOpen, setAccessOpen] = useState(false);
  const [documentsOpen, setDocumentsOpen] = useState(false);

  const profileQuery = useQuery({
    queryKey: ['member-profile', profileId],
    enabled: !!profileId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('full_name, avatar_url')
        .eq('id', profileId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const accessQuery = useQuery({
    queryKey: ['member-programming-access', membership?.gymId, profileId],
    enabled: !!membership?.gymId && !!profileId,
    queryFn: async (): Promise<MemberProgrammingAccessValue | null> => {
      const { data, error } = await supabase
        .from('member_programming_access')
        .select('mode, store_product_id')
        .eq('gym_id', membership!.gymId)
        .eq('profile_id', profileId)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as MemberProgrammingAccessValue | null;
    },
  });

  const name = profileQuery.data?.full_name ?? 'Member';
  const accessMode = accessQuery.data?.mode ?? 'free';

  return (
    <>
      <ProgrammingCalendar
        mode="manage"
        memberScope={{ profileId, name }}
        topBar={
          <View className="pt-3 gap-2">
            <BackLink fallbackHref="/management/members" />
            <View className="flex-row items-center gap-3">
              <Avatar
                name={name}
                avatarUrl={profileQuery.data?.avatar_url}
                size={32}
              />
              <Text className="flex-1 text-ink dark:text-ink-dk text-lg font-semibold">
                {name}
              </Text>
            </View>
          </View>
        }
        headerAction={
          <View className="flex-row gap-2">
            <ChipButton
              label={accessMode === 'paid' ? 'Paid' : 'Free'}
              icon={accessMode === 'paid' ? 'lock-closed-outline' : 'gift-outline'}
              onPress={() => setAccessOpen(true)}
            />
            <ChipButton
              label="Documents"
              icon="document-text-outline"
              onPress={() => setDocumentsOpen(true)}
            />
          </View>
        }
      />

      <MemberProgrammingAccessModal
        visible={accessOpen}
        profileId={profileId}
        memberName={name}
        current={accessQuery.data ?? null}
        onClose={() => setAccessOpen(false)}
      />

      <DocumentsModal
        visible={documentsOpen}
        profileId={profileId}
        memberName={name}
        onClose={() => setDocumentsOpen(false)}
      />
    </>
  );
}

// Upload / open / delete the member's programme PDFs. Objects live at
// <gym>/<profile>/<timestamp>.pdf in the private bucket; the row in
// member_programming_files is what the member's read policy matches.
function DocumentsModal({
  visible,
  profileId,
  memberName,
  onClose,
}: {
  visible: boolean;
  profileId: string;
  memberName: string;
  onClose: () => void;
}) {
  const colors = useThemeColors();
  const session = useSession();
  const { data: membership } = useGymMembership();
  const queryClient = useQueryClient();
  const files = useMemberProgrammingFiles(
    visible ? membership?.gymId : undefined,
    profileId,
  );
  const openFile = useOpenProgrammingFile();
  const [error, setError] = useState<string | null>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({
      queryKey: ['member-programming-files', membership?.gymId, profileId],
    });
    queryClient.invalidateQueries({ queryKey: ['programmed-members'] });
    queryClient.invalidateQueries({ queryKey: ['my-programming-access'] });
  };

  const upload = useMutation({
    mutationFn: async () => {
      if (!membership || !session) throw new Error('Missing context');
      const res = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (res.canceled || !res.assets?.length) return false;
      const asset = res.assets[0];
      const response = await fetch(asset.uri);
      const blob = await response.blob();
      const path = `${membership.gymId}/${profileId}/${Date.now()}.pdf`;
      const { error: upErr } = await supabase.storage
        .from(MEMBER_PROGRAMMING_BUCKET)
        .upload(path, blob, { contentType: 'application/pdf', upsert: false });
      if (upErr) throw upErr;
      const title = (asset.name ?? 'Programme.pdf').replace(/\.pdf$/i, '');
      const { error: insErr } = await supabase
        .from('member_programming_files')
        .insert({
          gym_id: membership.gymId,
          profile_id: profileId,
          title,
          file_path: path,
          uploaded_by: session.user.id,
        });
      if (insErr) throw insErr;
      return true;
    },
    onSuccess: (uploaded) => {
      if (uploaded) {
        setError(null);
        invalidate();
      }
    },
    onError: (e) => setError(errorMessage(e, 'Could not upload the PDF')),
  });

  const remove = useMutation({
    mutationFn: async (file: { id: string; file_path: string }) => {
      const { error: rmErr } = await supabase.storage
        .from(MEMBER_PROGRAMMING_BUCKET)
        .remove([file.file_path]);
      if (rmErr) throw rmErr;
      const { error } = await supabase
        .from('member_programming_files')
        .delete()
        .eq('id', file.id);
      if (error) throw error;
    },
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (e) => setError(errorMessage(e, 'Could not remove the PDF')),
  });

  return (
    <Sheet
      visible={visible}
      title="Programme documents"
      subtitle={`PDFs ${memberName} can open from their Programming tab.`}
      onClose={onClose}
      actions={
        <>
          <SheetAction>
            <Button variant="secondary" onPress={onClose}>
              Close
            </Button>
          </SheetAction>
          <SheetAction grow>
            <Button onPress={() => upload.mutate()} loading={upload.isPending}>
              Upload PDF
            </Button>
          </SheetAction>
        </>
      }>
      <View className="gap-2 pb-1">
            {files.data && files.data.length > 0 ? (
              files.data.map((f) => (
                <View
                  key={f.id}
                  className="bg-raised dark:bg-raised-dk rounded-lg px-3 py-2 flex-row items-center gap-2">
                  <Ionicons
                    name="document-text-outline"
                    size={18}
                    color={colors.ink2}
                  />
                  <Pressable
                    className="flex-1 active:opacity-70"
                    onPress={() => openFile.mutate(f.file_path)}>
                    <Text className="text-ink dark:text-ink-dk text-sm font-medium">
                      {f.title}
                    </Text>
                    <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                      Added {formatDate(f.created_at)}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => remove.mutate(f)}
                    hitSlop={6}
                    accessibilityLabel={`Remove ${f.title}`}
                    className="w-8 h-8 rounded-lg items-center justify-center active:bg-raised dark:active:bg-raised-dk">
                    <Ionicons name="trash-outline" size={16} color={colors.ink3} />
                  </Pressable>
                </View>
              ))
            ) : (
              <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
                No documents yet.
              </Text>
            )}
          {error ? (
            <Text
              accessibilityLiveRegion="polite"
              className="text-red-500 dark:text-red-400 text-[13px]">
              {error}
            </Text>
          ) : null}
      </View>
    </Sheet>
  );
}

type ProgrammedMember = {
  profile_id: string;
  full_name: string | null;
  avatar_url: string | null;
  mode: 'free' | 'paid';
  days_total: number;
  upcoming_days: number;
  last_date: string | null;
  files_total: number;
};

type SearchRow = {
  profile_id: string;
  profiles: { full_name: string | null; avatar_url: string | null } | null;
};

function IndividualsList() {
  const colors = useThemeColors();
  const { data: membership } = useGymMembership();
  const [search, setSearch] = useState('');

  const programmed = useQuery({
    queryKey: ['programmed-members', membership?.gymId],
    enabled: !!membership?.gymId,
    queryFn: async (): Promise<ProgrammedMember[]> => {
      const { data, error } = await supabase.rpc('list_programmed_members', {
        p_gym_id: membership!.gymId,
      });
      if (error) throw error;
      return (data ?? []) as ProgrammedMember[];
    },
  });

  const cohort = useQuery({
    queryKey: ['programming-candidates', membership?.gymId],
    enabled: !!membership?.gymId,
    queryFn: async (): Promise<SearchRow[]> => {
      const { data, error } = await supabase
        .from('v_member_cohort')
        .select('profile_id, profiles!profile_id(full_name, avatar_url)')
        .eq('gym_id', membership!.gymId);
      if (error) throw error;
      return (data ?? []) as unknown as SearchRow[];
    },
  });

  const programmedIds = new Set((programmed.data ?? []).map((m) => m.profile_id));
  const term = search.trim().toLowerCase();
  const candidates = (cohort.data ?? [])
    .filter((m) => !programmedIds.has(m.profile_id))
    .filter(
      (m) =>
        term.length === 0 ||
        (m.profiles?.full_name ?? '').toLowerCase().includes(term),
    )
    .slice(0, 30);

  const open = (profile: string) =>
    router.push({ pathname: '/management/member-programming', params: { profile } });

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-6 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <BackLink fallbackHref="/(staff)/programming" />
        <PageHead
          title="Individual programming"
          subtitle="Personal programmes written for one member, free or sold through the store and memberships."
        />

        <View className="gap-2">
          <Text className="text-ink-2 dark:text-ink-2-dk font-semibold">
            With a programme
          </Text>
          {programmed.isLoading ? (
            <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
              Loading…
            </Text>
          ) : (programmed.data ?? []).length === 0 ? (
            <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4">
              <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
                No individual programming yet — pick a member below to start.
              </Text>
            </View>
          ) : (
            (programmed.data ?? []).map((m) => (
              <Pressable
                key={m.profile_id}
                onPress={() => open(m.profile_id)}
                className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-3 flex-row items-center gap-3 active:bg-raised dark:active:bg-raised-dk">
                <Avatar name={m.full_name} avatarUrl={m.avatar_url} size={36} />
                <View className="flex-1">
                  <Text className="text-ink dark:text-ink-dk font-medium">
                    {m.full_name ?? 'Member'}
                  </Text>
                  <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                    {[
                      `${m.days_total} day${m.days_total === 1 ? '' : 's'}`,
                      m.upcoming_days > 0 ? `${m.upcoming_days} upcoming` : null,
                      m.files_total > 0
                        ? `${m.files_total} PDF${m.files_total === 1 ? '' : 's'}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                </View>
                <View
                  className={`rounded-full px-2 py-0.5 ${
                    m.mode === 'paid'
                      ? 'bg-amber-100 dark:bg-amber-900/40'
                      : 'bg-raised dark:bg-raised-dk'
                  }`}>
                  <Text
                    className={`text-[10px] font-semibold uppercase tracking-wider ${
                      m.mode === 'paid'
                        ? 'text-amber-700 dark:text-amber-300'
                        : 'text-ink-2 dark:text-ink-2-dk'
                    }`}>
                    {m.mode}
                  </Text>
                </View>
              </Pressable>
            ))
          )}
        </View>

        <View className="gap-2">
          <Text className="text-ink-2 dark:text-ink-2-dk font-semibold">
            Start a programme
          </Text>
          <Input
            label="Search members"
            placeholder="Name"
            value={search}
            onChangeText={setSearch}
            autoCapitalize="none"
          />
          {candidates.map((m) => (
            <Pressable
              key={m.profile_id}
              onPress={() => open(m.profile_id)}
              className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-3 flex-row items-center gap-3 active:bg-raised dark:active:bg-raised-dk">
              <Avatar
                name={m.profiles?.full_name}
                avatarUrl={m.profiles?.avatar_url}
                size={36}
              />
              <Text className="flex-1 text-ink dark:text-ink-dk font-medium">
                {m.profiles?.full_name ?? 'Member'}
              </Text>
              <Ionicons name="chevron-forward" size={15} color={colors.ink3} />
            </Pressable>
          ))}
          {cohort.data && candidates.length === 0 ? (
            <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
              {term ? 'No members match.' : 'Everyone already has a programme.'}
            </Text>
          ) : null}
        </View>
      </ScrollView>
    </Screen>
  );
}
