import { useQuery } from '@tanstack/react-query';

import { useSession } from '@/lib/auth';
import { isCheckInDue } from '@/lib/injuries';
import { supabase } from '@/lib/supabase';
import type { InjurySide, InjuryStatus } from '@/types/database';

export type InjuryRow = {
  id: string;
  gym_id: string;
  profile_id: string;
  body_region: string;
  side: InjurySide;
  description: string | null;
  pain_level: number;
  movements_hurt: string[];
  movements_ok: string[];
  started_on: string;
  status: InjuryStatus;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
};

// Sole owner of the ['my-injuries'] key — the tracker screen, the
// Track-home tile badge, and the inbox check-in banner all read this
// one query so their counts can never disagree.
export function useMyInjuries() {
  const session = useSession();
  return useQuery({
    queryKey: ['my-injuries', session?.user.id],
    enabled: !!session?.user.id,
    queryFn: async (): Promise<InjuryRow[]> => {
      const { data, error } = await supabase
        .from('member_injuries')
        .select('*')
        .eq('profile_id', session!.user.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as InjuryRow[];
    },
  });
}

export function dueCheckIns(rows: InjuryRow[] | undefined): InjuryRow[] {
  return (rows ?? []).filter((r) => isCheckInDue(r.updated_at, r.status));
}
