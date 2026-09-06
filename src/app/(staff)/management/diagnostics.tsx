import { useQuery } from '@tanstack/react-query';
import { Redirect } from 'expo-router';

import { BackLink } from '@/components/BackLink';
import { EmptyState } from '@/components/EmptyState';
import { ListRow, RuledList } from '@/components/ListRow';
import { PageHead } from '@/components/PageHead';
import { PageScroll } from '@/components/PageScroll';
import { Screen } from '@/components/Screen';
import { useGymMembership } from '@/lib/auth';
import { formatDate } from '@/lib/format-date';
import { supabase } from '@/lib/supabase';
import { useCan } from '@/lib/useCan';

type ClientError = {
  id: number;
  route: string | null;
  message: string;
  platform: string | null;
  app_version: string | null;
  created_at: string;
};

// What broke on whose screen (0281): the last fifty crash reports from
// this gym's members and staff, newest first. Owner-only through the
// same capability the table's read policy checks, so a search result
// that opens this page never opens an empty one.
export default function Diagnostics() {
  const canSee = useCan('can_manage_staff');
  const { data: membership } = useGymMembership();

  const errors = useQuery({
    queryKey: ['client-errors', membership?.gymId],
    enabled: !!membership?.gymId && canSee === true,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('client_errors')
        .select('id, route, message, platform, app_version, created_at')
        .eq('gym_id', membership!.gymId)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as ClientError[];
    },
  });

  if (canSee === false) return <Redirect href="/management" />;

  const rows = errors.data ?? [];

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <PageScroll contentContainerClassName="gap-4 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <BackLink fallbackHref="/management" coveredByNav />
        <PageHead
          title="Diagnostics"
          subtitle="Crashes and unhandled errors reported from the app, kept for thirty days."
        />
        {errors.isLoading ? (
          <EmptyState kind="loading" rows={4} title="Loading reports" />
        ) : rows.length === 0 ? (
          <EmptyState
            icon="checkmark-circle-outline"
            title="Nothing has broken"
            description="When the app crashes on a member's or a coach's device, the route and the error land here."
          />
        ) : (
          <RuledList>
            {rows.map((e, i) => (
              <ListRow
                key={e.id}
                ruled
                first={i === 0}
                wrap
                title={e.message}
                subtitle={[
                  e.route ?? 'unknown route',
                  e.platform ?? null,
                  e.app_version ?? null,
                  formatDate(e.created_at),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              />
            ))}
          </RuledList>
        )}
      </PageScroll>
    </Screen>
  );
}
