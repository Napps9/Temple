import { useQuery } from '@tanstack/react-query';

import { useSession } from './auth';
import { supabase } from './supabase';
import type { GymRole } from '@/types/database';

export type MyGym = {
  gym_id: string;
  gym_name: string;
  role: GymRole;
  joined_at: string;
  left_at: string | null;
};

// Every membership this account has held, left gyms included — the plain
// gyms embed refuses a left gym's name, so this is the definer RPC from
// 0255. Read by Account's "Your gyms" and by the account menu's switch
// rows (0283).
export function useMyGyms() {
  const session = useSession();
  return useQuery({
    queryKey: ['my-gyms', session?.user.id],
    enabled: !!session?.user.id,
    queryFn: async (): Promise<MyGym[]> => {
      const { data, error } = await supabase.rpc('my_gyms');
      if (error) throw error;
      return (data ?? []) as MyGym[];
    },
  });
}
