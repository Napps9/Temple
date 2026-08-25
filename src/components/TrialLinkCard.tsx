import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Platform, Pressable, View } from 'react-native';

import { ChipButton } from './ChipButton';
import { Text } from './Text';
import { FieldLabel } from './SectionLabel';
import { trialUrl } from '@/lib/brand';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

type ClassTypeRow = { id: string; name: string };
type PassRow = {
  id: string;
  token: string;
  kind: string;
  class_type_id: string | null;
  session_id: string | null;
  invited_name: string | null;
  expires_at: string;
  created_at: string;
};

function origin(): string {
  return Platform.OS === 'web' && typeof window !== 'undefined'
    ? window.location.origin
    : 'https://app.jointemple.io';
}

// Minting the free way in. A link is either for the room — post it, and
// whoever opens it claims a seat — or for one prospect, in which case it
// only works from the address it was sent to.
//
// Deliberately no "which class" picker beyond the class type: choosing
// a single session makes a link that dies the moment that class does,
// and the owner nearly always means "a Foundations class, whenever
// suits you".
export function TrialLinkCard({
  gymId,
  lead,
}: {
  gymId: string;
  lead?: { id: string; full_name: string; email: string | null } | null;
}) {
  const queryClient = useQueryClient();
  const [classTypeId, setClassTypeId] = useState<string | null>(null);
  const [minted, setMinted] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const classTypes = useQuery({
    queryKey: ['trial-link-class-types', gymId],
    queryFn: async (): Promise<ClassTypeRow[]> => {
      const { data, error: e } = await supabase
        .from('class_types')
        .select('id, name')
        .eq('gym_id', gymId)
        .is('archived_at', null)
        .order('name');
      if (e) throw e;
      return (data ?? []) as ClassTypeRow[];
    },
  });

  const live = useQuery({
    queryKey: ['trial-passes', gymId, lead?.id ?? null],
    queryFn: async (): Promise<PassRow[]> => {
      let q = supabase
        .from('trial_passes')
        .select(
          'id, token, kind, class_type_id, session_id, invited_name, expires_at, created_at',
        )
        .eq('gym_id', gymId)
        .is('revoked_at', null)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(5);
      if (lead?.id) q = q.eq('lead_id', lead.id);
      const { data, error: e } = await q;
      if (e) throw e;
      return (data ?? []) as PassRow[];
    },
  });

  const mint = useMutation({
    mutationFn: async (): Promise<string> => {
      const chosen = classTypeId ?? classTypes.data?.[0]?.id ?? null;
      if (!chosen) throw new Error('Add a class type first');
      const { data, error: e } = await supabase.rpc('create_trial_pass', {
        p_gym_id: gymId,
        p_class_type_id: chosen,
        p_lead_id: lead?.id ?? null,
        p_invited_email: lead?.email ?? null,
        p_invited_name: lead?.full_name ?? null,
      });
      if (e) throw e;
      const row = ((data ?? []) as { token: string }[])[0];
      if (!row) throw new Error('No link came back');
      return row.token;
    },
    onSuccess: (token) => {
      setError(null);
      setMinted(token);
      queryClient.invalidateQueries({ queryKey: ['trial-passes'] });
    },
    onError: (e) => setError(errorMessage(e, 'Could not create a trial link')),
  });

  const revoke = useMutation({
    mutationFn: async (passId: string) => {
      const { error: e } = await supabase.rpc('revoke_trial_pass', {
        p_pass_id: passId,
      });
      if (e) throw e;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trial-passes'] });
      setMinted(null);
    },
    onError: (e) => setError(errorMessage(e, 'Could not revoke that link')),
  });

  const url = minted ? trialUrl(origin(), minted) : null;

  function copy(value: string) {
    if (Platform.OS === 'web' && typeof navigator !== 'undefined') {
      navigator.clipboard?.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  }

  return (
    <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-3">
      <Text className="text-ink dark:text-ink-dk font-semibold">
        {lead ? `Send ${lead.full_name.split(' ')[0]} a free class` : 'Free class link'}
      </Text>
      <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
        {lead
          ? lead.email
            ? `One class, free, on their own account. Only ${lead.email} can claim it.`
            : 'This lead has no email on file — add one and the link can be sent to them.'
          : 'Post this anywhere. Whoever opens it picks a class, claims a free spot and signs your waiver before they train.'}
      </Text>

      {(classTypes.data ?? []).length > 1 ? (
        <View className="gap-1.5">
          <FieldLabel>Which class</FieldLabel>
          <View className="flex-row flex-wrap gap-1.5">
            {(classTypes.data ?? []).map((ct) => {
              const on = (classTypeId ?? classTypes.data?.[0]?.id) === ct.id;
              return (
                <ChipButton
                  key={ct.id}
                  label={ct.name}
                  icon={on ? 'checkmark' : 'ellipse-outline'}
                  tone={on ? 'filled' : 'neutral'}
                  onPress={() => setClassTypeId(ct.id)}
                />
              );
            })}
          </View>
        </View>
      ) : null}

      {url ? (
        <View className="gap-2">
          <View className="bg-raised dark:bg-raised-dk rounded-ctl px-3 py-2">
            <Text
              className="text-ink-2 dark:text-ink-2-dk text-sm font-mono"
              numberOfLines={1}>
              {url}
            </Text>
          </View>
          <View className="flex-row gap-2 flex-wrap">
            <ChipButton
              label={copied ? 'Copied' : 'Copy link'}
              icon={copied ? 'checkmark' : 'copy-outline'}
              onPress={() => copy(url)}
            />
            <ChipButton
              label="New link"
              icon="refresh-outline"
              onPress={() => setMinted(null)}
            />
          </View>
        </View>
      ) : (
        <ChipButton
          tone="filled"
          label={mint.isPending ? 'Creating…' : 'Create link'}
          icon="ticket-outline"
          disabled={mint.isPending || (lead != null && !lead.email)}
          onPress={() => mint.mutate()}
        />
      )}

      {error ? (
        <Text className="text-red-500 dark:text-red-400 text-xs">{error}</Text>
      ) : null}

      {(live.data ?? []).length > 0 ? (
        <View className="gap-1.5 border-t border-line dark:border-line-dk pt-3">
          <FieldLabel>Live links</FieldLabel>
          {(live.data ?? []).map((p) => (
            <View key={p.id} className="flex-row items-center gap-2">
              <Pressable
                onPress={() => copy(trialUrl(origin(), p.token))}
                hitSlop={4}
                className="flex-1 active:opacity-70">
                <Text className="text-ink-2 dark:text-ink-2-dk text-xs font-mono">
                  {p.token}
                  {p.invited_name ? ` · ${p.invited_name}` : ''}
                </Text>
              </Pressable>
              <ChipButton
                label="Revoke"
                icon="close"
                tone="red"
                onPress={() => revoke.mutate(p.id)}
              />
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}
