// Data access + send orchestration for the Communications Suite. The
// pure block / render / audience logic lives under ./email; this module
// is the React-Query + Supabase glue the screens lean on.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useGymMembership } from './auth';
import type { AudienceDefinition } from './email/audience';
import type { EmailDocument } from './email/blocks';
import { renderEmailHtml, renderEmailText } from './email/render';
import { supabase } from './supabase';
import type { Database, Json } from '@/types/database';

export type CampaignStatus =
  | 'draft'
  | 'scheduled'
  | 'sending'
  | 'sent'
  | 'failed'
  | 'cancelled';

export type CampaignListRow = {
  id: string;
  title: string;
  subject: string;
  preheader: string;
  status: CampaignStatus;
  recipient_count: number;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CommsSettings = {
  gym_id: string;
  from_name: string | null;
  reply_to: string | null;
  footer_business_name: string | null;
  footer_address: string | null;
};

export type StatusTone = 'gray' | 'amber' | 'green' | 'red';

export function campaignStatusMeta(status: CampaignStatus): {
  label: string;
  tone: StatusTone;
} {
  switch (status) {
    case 'draft':
      return { label: 'Draft', tone: 'gray' };
    case 'scheduled':
      return { label: 'Scheduled', tone: 'amber' };
    case 'sending':
      return { label: 'Sending', tone: 'amber' };
    case 'sent':
      return { label: 'Sent', tone: 'green' };
    case 'failed':
      return { label: 'Failed', tone: 'red' };
    case 'cancelled':
      return { label: 'Cancelled', tone: 'gray' };
  }
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function useCampaigns() {
  const { data: membership } = useGymMembership();
  return useQuery({
    queryKey: ['comms-campaigns', membership?.gymId],
    enabled: !!membership?.gymId,
    queryFn: async (): Promise<CampaignListRow[]> => {
      const { data, error } = await supabase
        .from('email_campaigns')
        .select(
          'id, title, subject, preheader, status, recipient_count, sent_at, created_at, updated_at',
        )
        .eq('gym_id', membership!.gymId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as CampaignListRow[];
    },
  });
}

export function useCommsSettings() {
  const { data: membership } = useGymMembership();
  return useQuery({
    queryKey: ['comms-settings', membership?.gymId],
    enabled: !!membership?.gymId,
    queryFn: async (): Promise<CommsSettings | null> => {
      const { data, error } = await supabase
        .from('gym_comms_settings')
        .select('gym_id, from_name, reply_to, footer_business_name, footer_address')
        .eq('gym_id', membership!.gymId)
        .maybeSingle();
      if (error) throw error;
      return (data as CommsSettings) ?? null;
    },
  });
}

// Distinct member-tag labels for the audience builder's tag picker.
export function useGymTagLabels() {
  const { data: membership } = useGymMembership();
  return useQuery({
    queryKey: ['comms-tag-labels', membership?.gymId],
    enabled: !!membership?.gymId,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase
        .from('member_tags')
        .select('label')
        .eq('gym_id', membership!.gymId);
      if (error) throw error;
      const labels = new Set<string>();
      for (const r of (data ?? []) as { label: string }[]) labels.add(r.label);
      return [...labels].sort((a, b) => a.localeCompare(b));
    },
  });
}

// Live recipient count for the current audience definition.
export function useAudienceCount(definition: AudienceDefinition | null) {
  const { data: membership } = useGymMembership();
  return useQuery({
    queryKey: ['comms-audience-count', membership?.gymId, definition],
    enabled: !!membership?.gymId && !!definition,
    queryFn: async (): Promise<number> => {
      const { data, error } = await supabase.rpc('comms_audience_count', {
        p_gym_id: membership!.gymId,
        p_definition: definition as unknown as Json,
      });
      if (error) throw error;
      return (data as number) ?? 0;
    },
  });
}

export type SendResult = { recipientCount: number; mode: 'live' | 'simulated' };

// Orchestrates a send: compile the document to HTML/text, snapshot the
// recipients server-side (comms_send_campaign), then hand off to the
// delivery worker. If the worker isn't reachable (e.g. functions aren't
// served locally) we fall back to the simulation finaliser so the suite
// still completes end-to-end — clearly labelled as simulated.
export function useSendCampaign() {
  const queryClient = useQueryClient();
  return useMutation<
    SendResult,
    Error,
    {
      campaignId: string;
      document: EmailDocument;
      preheader: string;
      footer: { businessName?: string | null; address?: string | null };
    }
  >({
    mutationFn: async ({ campaignId, document, preheader, footer }) => {
      const html = renderEmailHtml(document, { preheader, footer });
      const text = renderEmailText(document, { footer });

      const snapshot = await supabase.rpc('comms_send_campaign', {
        p_campaign_id: campaignId,
        p_html: html,
        p_text: text,
      });
      if (snapshot.error) throw snapshot.error;
      const recipientCount = (snapshot.data as number) ?? 0;

      let mode: 'live' | 'simulated' = 'live';
      try {
        const { data, error } = await supabase.functions.invoke('send-campaign', {
          body: { campaign_id: campaignId },
        });
        if (error) throw error;
        mode = (data as { mode?: 'live' | 'simulated' })?.mode ?? 'live';
      } catch {
        // Worker unreachable — only finalise as simulated if the snapshot
        // really did leave the campaign mid-send.
        const { data: row } = await supabase
          .from('email_campaigns')
          .select('status')
          .eq('id', campaignId)
          .single();
        if (row?.status === 'sending') {
          const sim = await supabase.rpc('comms_finalize_simulation', {
            p_campaign_id: campaignId,
          });
          if (sim.error) throw sim.error;
        }
        mode = 'simulated';
      }

      return { recipientCount, mode };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['comms-campaigns'] });
      queryClient.invalidateQueries({ queryKey: ['comms-campaign'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Sending domain (per-gym domain authentication via the sending-domain
// edge function).
// ---------------------------------------------------------------------------

export type SendingDomainRow =
  Database['public']['Tables']['gym_sending_domains']['Row'];

export function useSendingDomain() {
  const { data: membership } = useGymMembership();
  return useQuery({
    queryKey: ['comms-sending-domain', membership?.gymId],
    enabled: !!membership?.gymId,
    queryFn: async (): Promise<SendingDomainRow | null> => {
      const { data, error } = await supabase
        .from('gym_sending_domains')
        .select('*')
        .eq('gym_id', membership!.gymId)
        .maybeSingle();
      if (error) throw error;
      return (data as SendingDomainRow) ?? null;
    },
  });
}

export type DomainAction =
  | { action: 'connect'; domain: string; from_local?: string }
  | { action: 'verify' }
  | { action: 'disconnect' }
  | { action: 'update_from_local'; from_local: string };

// supabase.functions.invoke surfaces a non-2xx as a FunctionsHttpError whose
// `.context` is the raw Response — our functions answer with { error } JSON,
// so dig that friendly message out rather than showing "non-2xx status".
async function functionErrorMessage(error: unknown): Promise<string> {
  const ctx = (error as { context?: Response } | null)?.context;
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = await ctx.json();
      if (body?.error) return String(body.error);
    } catch {
      // not JSON — fall through
    }
  }
  return error instanceof Error ? error.message : 'Something went wrong';
}

export function useSendingDomainAction() {
  const queryClient = useQueryClient();
  const { data: membership } = useGymMembership();
  return useMutation<{ ok?: boolean }, Error, DomainAction>({
    mutationFn: async (input) => {
      if (!membership?.gymId) throw new Error('No gym selected');
      const { data, error } = await supabase.functions.invoke('sending-domain', {
        body: { ...input, gym_id: membership.gymId },
      });
      if (error) throw new Error(await functionErrorMessage(error));
      return (data as { ok?: boolean }) ?? {};
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['comms-sending-domain'] });
    },
  });
}
