// Replace with `supabase gen types typescript --local > src/types/database.ts`
// once the local Supabase project is initialised.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type GymRole = 'owner' | 'admin' | 'coach' | 'staff' | 'member';

export type PlanSubState =
  | 'pending'
  | 'active'
  | 'paused'
  | 'cancelled_at_period_end'
  | 'lapsed'
  | 'cancelled'
  | 'refunded_retained';

export type MembershipPlanKind =
  | 'unlimited'
  | 'credit_period'
  | 'credit_pack'
  | 'programming_only';

export type StaffAlertKind = 'parq_flag' | 'injury_new' | 'injury_update';

export type InjurySide = 'left' | 'right' | 'both' | 'na';
export type InjuryStatus = 'active' | 'improving' | 'resolved';
export type InjuryFeeling = 'better' | 'same' | 'worse';

export type LeadStatus =
  | 'cold'
  | 'contacted'
  | 'intro_booked'
  | 'trial_attended'
  | 'committed'
  | 'converted'
  | 'lost';

export type StoreProductKind = 'physical' | 'digital';

export type StoreOrderStatus =
  | 'pending'
  | 'paid'
  | 'fulfilled'
  | 'cancelled'
  | 'refunded';

export type StoreSubscriptionStatus = 'active' | 'past_due' | 'cancelled';

export type Database = {
  public: {
    Tables: {
      gyms: {
        Row: {
          id: string;
          name: string;
          slug: string;
          created_at: string;
          coach_credit_policy: 'all_scheduled' | 'only_checked_in';
          currency: string;
          weight_unit: 'kg' | 'lb';
          class_leaderboards_enabled: boolean;
          strength_leaderboards_enabled: boolean;
          dm_scope: 'full_gym' | 'member_coach_only';
          logo_url: string | null;
          primary_color: string;
          secondary_color: string;
          text_color: string;
          public_signup_enabled: boolean;
          logo_url_dark: string | null;
          primary_color_dark: string | null;
          secondary_color_dark: string | null;
          text_color_dark: string | null;
          week_starts_on: 'mon' | 'sun';
          timezone: string;
          default_class_capacity: number;
          default_class_minutes: number;
          expiring_within_days: number;
          parq_expiry_days: number;
          health_retention_months: number;
          lead_conversion_window_days: number;
          materialisation_horizon_weeks: number;
          subscription_resolution: 'credits_first' | 'newest_first' | 'highest_priority';
          booking_window_hours_ahead: number | null;
          booking_cutoff_minutes_before: number;
          cancel_cutoff_minutes_before: number;
          public_lead_capture_enabled: boolean;
          lead_sms_enabled: boolean;
          lead_retention_days: number;
          operating_defaults_reviewed_at: string | null;
          cancel_cutoff_mode: 'relative' | 'day_before';
          cancel_cutoff_time: string | null;
          cancel_cutoff_days_before: number;
          cover_warning_hours: number;
          members_can_self_checkout: boolean;
          require_membership_to_book: boolean;
          allow_minors: boolean;
          membership_upgrade_policy: 'self_serve' | 'request';
          membership_downgrade_policy: 'self_serve' | 'request';
          membership_cancel_policy: 'self_serve' | 'request';
          store_enabled: boolean;
          store_shipping_fee_cents: number;
          discipline: 'crossfit' | 'hyrox';
          website_builder_enabled: boolean;
          onboarding_dismissed_at: string | null;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          created_at?: string;
          coach_credit_policy?: 'all_scheduled' | 'only_checked_in';
          currency?: string;
          weight_unit?: 'kg' | 'lb';
          class_leaderboards_enabled?: boolean;
          strength_leaderboards_enabled?: boolean;
          dm_scope?: 'full_gym' | 'member_coach_only';
          logo_url?: string | null;
          primary_color?: string;
          secondary_color?: string;
          text_color?: string;
          public_signup_enabled?: boolean;
          logo_url_dark?: string | null;
          primary_color_dark?: string | null;
          secondary_color_dark?: string | null;
          text_color_dark?: string | null;
          week_starts_on?: 'mon' | 'sun';
          timezone?: string;
          default_class_capacity?: number;
          default_class_minutes?: number;
          expiring_within_days?: number;
          parq_expiry_days?: number;
          health_retention_months?: number;
          lead_conversion_window_days?: number;
          materialisation_horizon_weeks?: number;
          subscription_resolution?: 'credits_first' | 'newest_first' | 'highest_priority';
          booking_window_hours_ahead?: number | null;
          booking_cutoff_minutes_before?: number;
          cancel_cutoff_minutes_before?: number;
          public_lead_capture_enabled?: boolean;
          lead_sms_enabled?: boolean;
          lead_retention_days?: number;
          operating_defaults_reviewed_at?: string | null;
          cancel_cutoff_mode?: 'relative' | 'day_before';
          cancel_cutoff_time?: string | null;
          cancel_cutoff_days_before?: number;
          cover_warning_hours?: number;
          discipline?: 'crossfit' | 'hyrox';
          onboarding_dismissed_at?: string | null;
        };
        Update: Partial<{
          id: string;
          name: string;
          slug: string;
          created_at: string;
          coach_credit_policy: 'all_scheduled' | 'only_checked_in';
          currency: string;
          class_leaderboards_enabled: boolean;
          strength_leaderboards_enabled: boolean;
          dm_scope: 'full_gym' | 'member_coach_only';
          logo_url: string | null;
          primary_color: string;
          secondary_color: string;
          text_color: string;
          public_signup_enabled: boolean;
          logo_url_dark: string | null;
          primary_color_dark: string | null;
          secondary_color_dark: string | null;
          text_color_dark: string | null;
          week_starts_on: 'mon' | 'sun';
          timezone: string;
          default_class_capacity: number;
          default_class_minutes: number;
          expiring_within_days: number;
          parq_expiry_days: number;
          health_retention_months: number;
          lead_conversion_window_days: number;
          materialisation_horizon_weeks: number;
          subscription_resolution: 'credits_first' | 'newest_first' | 'highest_priority';
          booking_window_hours_ahead: number | null;
          booking_cutoff_minutes_before: number;
          cancel_cutoff_minutes_before: number;
          public_lead_capture_enabled: boolean;
          lead_sms_enabled: boolean;
          lead_retention_days: number;
          operating_defaults_reviewed_at: string | null;
          cancel_cutoff_mode: 'relative' | 'day_before';
          cancel_cutoff_time: string | null;
          cancel_cutoff_days_before: number;
          cover_warning_hours: number;
          discipline: 'crossfit' | 'hyrox';
          onboarding_dismissed_at: string | null;
        }>;
        Relationships: [];
      };
      gym_websites: {
        Row: {
          id: string;
          gym_id: string;
          theme: string;
          design: Json;
          published: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          theme?: string;
          design?: Json;
          published?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          theme: string;
          design: Json;
          published: boolean;
          created_at: string;
          updated_at: string;
        }>;
        Relationships: [];
      };
      gym_website_domains: {
        Row: {
          gym_id: string;
          domain: string;
          status: 'pending' | 'verified' | 'error';
          records: Json;
          error_message: string | null;
          last_checked_at: string | null;
          verified_at: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          gym_id: string;
          domain: string;
          status?: 'pending' | 'verified' | 'error';
          records?: Json;
          error_message?: string | null;
          last_checked_at?: string | null;
          verified_at?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<{
          gym_id: string;
          domain: string;
          status: 'pending' | 'verified' | 'error';
          records: Json;
          error_message: string | null;
          last_checked_at: string | null;
          verified_at: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        }>;
        Relationships: [];
      };
      direct_messages: {
        Row: {
          id: string;
          gym_id: string;
          sender_id: string;
          recipient_id: string;
          body: string;
          created_at: string;
          read_at: string | null;
        };
        Insert: {
          id?: string;
          gym_id: string;
          sender_id: string;
          recipient_id: string;
          body: string;
          created_at?: string;
          read_at?: string | null;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          sender_id: string;
          recipient_id: string;
          body: string;
          created_at: string;
          read_at: string | null;
        }>;
        Relationships: [];
      };
      lead_sources: {
        Row: {
          id: string;
          gym_id: string;
          label: string;
          color: string;
          archived_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          label: string;
          color?: string;
          archived_at?: string | null;
          created_at?: string;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          label: string;
          color: string;
          archived_at: string | null;
          created_at: string;
        }>;
        Relationships: [];
      };
      leads: {
        Row: {
          id: string;
          gym_id: string;
          full_name: string;
          email: string | null;
          phone: string | null;
          source_id: string | null;
          status: LeadStatus;
          notes: string | null;
          objection: string | null;
          follow_up_at: string | null;
          captured_at: string;
          captured_by: string | null;
          assigned_coach_id: string | null;
          assigned_at: string | null;
          marketing_consent: boolean;
          consent_at: string | null;
          lawful_basis: string;
          consent_policy_version: string | null;
          converted_at: string | null;
          converted_profile_id: string | null;
          archived_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          full_name: string;
          email?: string | null;
          phone?: string | null;
          source_id?: string | null;
          status?: LeadStatus;
          notes?: string | null;
          objection?: string | null;
          follow_up_at?: string | null;
          captured_at?: string;
          captured_by?: string | null;
          assigned_coach_id?: string | null;
          assigned_at?: string | null;
          marketing_consent?: boolean;
          consent_at?: string | null;
          lawful_basis?: string;
          consent_policy_version?: string | null;
          converted_at?: string | null;
          converted_profile_id?: string | null;
          archived_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          full_name: string;
          email: string | null;
          phone: string | null;
          source_id: string | null;
          status: LeadStatus;
          notes: string | null;
          objection: string | null;
          follow_up_at: string | null;
          captured_at: string;
          captured_by: string | null;
          assigned_coach_id: string | null;
          assigned_at: string | null;
          marketing_consent: boolean;
          consent_at: string | null;
          lawful_basis: string;
          consent_policy_version: string | null;
          converted_at: string | null;
          converted_profile_id: string | null;
          archived_at: string | null;
          created_at: string;
          updated_at: string;
        }>;
        Relationships: [];
      };
      lead_assignment_rules: {
        Row: {
          gym_id: string;
          strategy: 'round_robin' | 'single_default' | 'manual';
          default_coach_id: string | null;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          gym_id: string;
          strategy?: 'round_robin' | 'single_default' | 'manual';
          default_coach_id?: string | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: Partial<{
          gym_id: string;
          strategy: 'round_robin' | 'single_default' | 'manual';
          default_coach_id: string | null;
          updated_at: string;
          updated_by: string | null;
        }>;
        Relationships: [];
      };
      lead_notifications: {
        Row: {
          id: string;
          gym_id: string;
          lead_id: string;
          channel: 'email' | 'in_app' | 'sms';
          recipient: string | null;
          recipient_profile_id: string | null;
          status: 'queued' | 'sent' | 'failed' | 'skipped' | 'read';
          error: string | null;
          idempotency_key: string;
          created_at: string;
          sent_at: string | null;
          read_at: string | null;
        };
        Insert: {
          id?: string;
          gym_id: string;
          lead_id: string;
          channel: 'email' | 'in_app' | 'sms';
          recipient?: string | null;
          recipient_profile_id?: string | null;
          status?: 'queued' | 'sent' | 'failed' | 'skipped' | 'read';
          error?: string | null;
          idempotency_key: string;
          created_at?: string;
          sent_at?: string | null;
          read_at?: string | null;
        };
        Update: Partial<{
          status: 'queued' | 'sent' | 'failed' | 'skipped' | 'read';
          error: string | null;
          sent_at: string | null;
          read_at: string | null;
        }>;
        Relationships: [];
      };
      gym_agent_settings: {
        Row: {
          gym_id: string;
          enabled: boolean;
          phone_number: string | null;
          voice_enabled: boolean;
          vapi_assistant_id: string | null;
          context: string | null;
          voice_provider: string | null;
          voice_id: string | null;
          voice_region: string | null;
          call_recording_enabled: boolean;
          call_recording_retention_days: number;
          recording_notice_at: string | null;
          daily_message_cap: number;
          conversation_retention_days: number;
          twilio_number_sid: string | null;
          vapi_phone_number_id: string | null;
          provisioned_at: string | null;
          front_desk_entitled: boolean;
          provision_status: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          gym_id: string;
          enabled?: boolean;
          phone_number?: string | null;
          voice_enabled?: boolean;
          vapi_assistant_id?: string | null;
          context?: string | null;
          voice_provider?: string | null;
          voice_id?: string | null;
          voice_region?: string | null;
          call_recording_enabled?: boolean;
          call_recording_retention_days?: number;
          recording_notice_at?: string | null;
          daily_message_cap?: number;
          conversation_retention_days?: number;
          twilio_number_sid?: string | null;
          vapi_phone_number_id?: string | null;
          provisioned_at?: string | null;
          front_desk_entitled?: boolean;
          provision_status?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<{
          enabled: boolean;
          phone_number: string | null;
          voice_enabled: boolean;
          vapi_assistant_id: string | null;
          context: string | null;
          voice_provider: string | null;
          voice_id: string | null;
          voice_region: string | null;
          call_recording_enabled: boolean;
          call_recording_retention_days: number;
          recording_notice_at: string | null;
          daily_message_cap: number;
          conversation_retention_days: number;
          twilio_number_sid: string | null;
          vapi_phone_number_id: string | null;
          provisioned_at: string | null;
          front_desk_entitled: boolean;
          provision_status: string;
          updated_at: string;
        }>;
        Relationships: [];
      };
      call_recordings: {
        Row: {
          id: string;
          gym_id: string;
          conversation_id: string;
          recording_path: string;
          duration_seconds: number | null;
          consent_state: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          conversation_id: string;
          recording_path: string;
          duration_seconds?: number | null;
          consent_state?: string | null;
          created_at?: string;
        };
        Update: Partial<{
          duration_seconds: number | null;
          consent_state: string | null;
        }>;
        Relationships: [];
      };
      agent_coaching_corrections: {
        Row: {
          id: string;
          gym_id: string;
          conversation_id: string | null;
          message_id: string | null;
          field_kind: 'fact' | 'tone' | 'rule' | 'exemplar';
          scope: 'example' | 'standing_rule';
          input_payload: Json | null;
          ai_suggestion: string | null;
          correction: string;
          was_overridden: boolean;
          active: boolean;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          conversation_id?: string | null;
          message_id?: string | null;
          field_kind: 'fact' | 'tone' | 'rule' | 'exemplar';
          scope: 'example' | 'standing_rule';
          input_payload?: Json | null;
          ai_suggestion?: string | null;
          correction: string;
          was_overridden?: boolean;
          active?: boolean;
          created_by?: string | null;
          created_at?: string;
        };
        Update: Partial<{
          active: boolean;
        }>;
        Relationships: [];
      };
      agent_recording_access_log: {
        Row: {
          id: string;
          gym_id: string;
          actor_id: string | null;
          recording_id: string | null;
          surface: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          actor_id?: string | null;
          recording_id?: string | null;
          surface?: string | null;
          created_at?: string;
        };
        Update: Partial<{
          surface: string | null;
        }>;
        Relationships: [];
      };
      agent_actions: {
        Row: {
          id: string;
          gym_id: string;
          teammate: 'revenue' | 'retention' | 'ops';
          action_kind:
            | 'chase_message'
            | 'plan_adjustment_offer'
            | 'retention_message'
            | 'cover_ask'
            | 'first_week_message'
            | 'credits_low_message'
            | 'plan_upgrade_offer'
            | 'class_return_message';
          subject_profile: string | null;
          subject_subscription: string | null;
          case_id: string | null;
          payload: Json;
          evidence: Json;
          status: 'proposed' | 'approved' | 'rejected' | 'executed' | 'expired';
          proposed_at: string;
          decided_by: string | null;
          decided_at: string | null;
          executed_at: string | null;
        };
        // No client write path — every write is a service-role RPC (0204).
        Insert: never;
        Update: never;
        Relationships: [];
      };
      programming_blocks: {
        Row: {
          id: string;
          gym_id: string;
          name: string;
          starts_on: string;
          ends_on: string;
          color: string;
          note: string | null;
          created_by: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          name: string;
          starts_on: string;
          ends_on: string;
          color?: string;
          note?: string | null;
          created_by: string;
          created_at?: string;
        };
        Update: Partial<{
          name: string;
          starts_on: string;
          ends_on: string;
          color: string;
          note: string | null;
        }>;
        Relationships: [];
      };
      gym_goals: {
        Row: {
          id: string;
          gym_id: string;
          kind: 'members';
          target_value: number;
          due_on: string;
          created_by: string;
          created_at: string;
          achieved_at: string | null;
        };
        Insert: {
          id?: string;
          gym_id: string;
          kind?: 'members';
          target_value: number;
          due_on: string;
          created_by: string;
          created_at?: string;
          achieved_at?: string | null;
        };
        Update: Partial<{
          target_value: number;
          due_on: string;
          achieved_at: string | null;
        }>;
        Relationships: [];
      };
      agent_authority: {
        Row: {
          gym_id: string;
          action_kind:
            | 'chase_message'
            | 'plan_adjustment_offer'
            | 'retention_message'
            | 'cover_ask'
            | 'first_week_message'
            | 'credits_low_message'
            | 'plan_upgrade_offer'
            | 'class_return_message';
          level: 'autonomous' | 'approval' | 'reserved';
          updated_by: string | null;
          updated_at: string;
        };
        // Writes go through set_money_job / decide_agent_action (0206).
        Insert: never;
        Update: never;
        Relationships: [];
      };
      agent_cases: {
        Row: {
          id: string;
          gym_id: string;
          plan_subscription_id: string;
          profile_id: string;
          opened_at: string;
          stage: 'watching' | 'touch_2_sent' | 'offer_pending' | 'closed';
          outcome: 'recovered' | 'adjusted' | 'lapsed' | 'left' | null;
          closed_at: string | null;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      agent_outbound_messages: {
        Row: {
          id: string;
          gym_id: string;
          case_id: string | null;
          action_id: string | null;
          recipient_profile_id: string | null;
          channel: 'email';
          subject: string;
          body: string;
          status: 'queued' | 'sent' | 'failed' | 'skipped';
          error: string | null;
          attempts: number;
          idempotency_key: string;
          created_at: string;
          sent_at: string | null;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      agent_message_templates: {
        Row: {
          gym_id: string;
          // cover_ask is absent by design: it re-asks through the cover
          // plumbing and never mails a member, so it has no template.
          kind:
            | 'chase_message'
            | 'plan_adjustment_offer'
            | 'retention_message'
            | 'first_week_message'
            | 'credits_low_message'
            | 'plan_upgrade_offer'
            | 'class_return_message';
          body: string;
          approved_by: string | null;
          approved_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      agent_conversations: {
        Row: {
          id: string;
          gym_id: string;
          phone: string;
          lead_id: string | null;
          channel: 'sms' | 'voice';
          status: 'active' | 'handed_off' | 'closed';
          last_message_at: string;
          last_message_role: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          phone: string;
          lead_id?: string | null;
          channel: 'sms' | 'voice';
          status?: 'active' | 'handed_off' | 'closed';
          last_message_at?: string;
          last_message_role?: string | null;
          created_at?: string;
        };
        Update: Partial<{
          lead_id: string | null;
          status: 'active' | 'handed_off' | 'closed';
          last_message_at: string;
          last_message_role: string | null;
        }>;
        Relationships: [];
      };
      agent_email_sends: {
        Row: {
          id: string;
          gym_id: string;
          conversation_id: string | null;
          email: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          conversation_id?: string | null;
          email: string;
          created_at?: string;
        };
        Update: Partial<{
          email: string;
        }>;
        Relationships: [];
      };
      agent_interviews: {
        Row: {
          id: string;
          gym_id: string;
          phone: string;
          status: 'calling' | 'completed' | 'failed' | 'applied' | 'discarded';
          transcript: string | null;
          draft_brief: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          phone: string;
          status?: 'calling' | 'completed' | 'failed' | 'applied' | 'discarded';
          transcript?: string | null;
          draft_brief?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<{
          status: 'calling' | 'completed' | 'failed' | 'applied' | 'discarded';
          transcript: string | null;
          draft_brief: string | null;
          updated_at: string;
        }>;
        Relationships: [];
      };
      agent_storage_purge_queue: {
        Row: {
          id: string;
          bucket: string;
          path: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          bucket?: string;
          path: string;
          created_at?: string;
        };
        Update: Partial<{
          path: string;
        }>;
        Relationships: [];
      };
      agent_messages: {
        Row: {
          id: string;
          conversation_id: string;
          gym_id: string;
          role: 'lead' | 'agent' | 'staff' | 'system';
          body: string;
          provider_sid: string | null;
          seconds_from_start: number | null;
          duration_ms: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          gym_id: string;
          role: 'lead' | 'agent' | 'staff' | 'system';
          body: string;
          provider_sid?: string | null;
          seconds_from_start?: number | null;
          duration_ms?: number | null;
          created_at?: string;
        };
        Update: Partial<{
          body: string;
        }>;
        Relationships: [];
      };
      gym_announcements: {
        Row: {
          id: string;
          gym_id: string;
          posted_by: string | null;
          title: string;
          body: string;
          pinned: boolean;
          // The closure this notice is about (0257); FK guards same-gym.
          closure_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          posted_by?: string | null;
          title: string;
          body: string;
          pinned?: boolean;
          closure_id?: string | null;
          created_at?: string;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          posted_by: string | null;
          title: string;
          body: string;
          pinned: boolean;
          closure_id: string | null;
          created_at: string;
        }>;
        Relationships: [];
      };
      announcement_reads: {
        Row: {
          announcement_id: string;
          profile_id: string;
          read_at: string;
        };
        Insert: {
          announcement_id: string;
          profile_id: string;
          read_at?: string;
        };
        Update: Partial<{
          announcement_id: string;
          profile_id: string;
          read_at: string;
        }>;
        Relationships: [];
      };
      class_session_broadcasts: {
        Row: {
          id: string;
          gym_id: string;
          class_session_id: string;
          sender_id: string | null;
          body: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          class_session_id: string;
          sender_id?: string | null;
          body: string;
          created_at?: string;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          class_session_id: string;
          sender_id: string | null;
          body: string;
          created_at: string;
        }>;
        Relationships: [];
      };
      class_session_broadcast_reads: {
        Row: {
          broadcast_id: string;
          profile_id: string;
          read_at: string;
        };
        Insert: {
          broadcast_id: string;
          profile_id: string;
          read_at?: string;
        };
        Update: Partial<{
          broadcast_id: string;
          profile_id: string;
          read_at: string;
        }>;
        Relationships: [];
      };
      coach_pay_rates: {
        Row: {
          id: string;
          gym_id: string;
          profile_id: string;
          class_type_id: string;
          per_class_cents: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          profile_id: string;
          class_type_id: string;
          per_class_cents: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          profile_id: string;
          class_type_id: string;
          per_class_cents: number;
          created_at: string;
          updated_at: string;
        }>;
        Relationships: [];
      };
      coach_class_type_qualifications: {
        Row: {
          gym_id: string;
          profile_id: string;
          class_type_id: string;
          qualified: boolean;
          updated_by: string | null;
          updated_at: string;
        };
        Insert: {
          gym_id: string;
          profile_id: string;
          class_type_id: string;
          qualified?: boolean;
          updated_by?: string | null;
          updated_at?: string;
        };
        Update: Partial<{
          gym_id: string;
          profile_id: string;
          class_type_id: string;
          qualified: boolean;
          updated_by: string | null;
          updated_at: string;
        }>;
        Relationships: [];
      };
      parq_questionnaires: {
        Row: {
          id: string;
          gym_id: string;
          version: number;
          is_active: boolean;
          published_by: string | null;
          published_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          version: number;
          is_active?: boolean;
          published_by?: string | null;
          published_at?: string;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          version: number;
          is_active: boolean;
          published_by: string | null;
          published_at: string;
        }>;
        Relationships: [];
      };
      parq_questions: {
        Row: {
          id: string;
          questionnaire_id: string;
          sort_order: number;
          prompt: string;
          flag_on_yes: boolean;
        };
        Insert: {
          id?: string;
          questionnaire_id: string;
          sort_order: number;
          prompt: string;
          flag_on_yes?: boolean;
        };
        Update: Partial<{
          id: string;
          questionnaire_id: string;
          sort_order: number;
          prompt: string;
          flag_on_yes: boolean;
        }>;
        Relationships: [];
      };
      parq_responses: {
        Row: {
          id: string;
          gym_id: string;
          profile_id: string;
          questionnaire_id: string;
          completed_at: string;
          has_flag: boolean;
        };
        Insert: {
          id?: string;
          gym_id: string;
          profile_id: string;
          questionnaire_id: string;
          completed_at?: string;
          has_flag?: boolean;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          profile_id: string;
          questionnaire_id: string;
          completed_at: string;
          has_flag: boolean;
        }>;
        Relationships: [];
      };
      parq_answers: {
        Row: {
          response_id: string;
          question_id: string;
          answered_yes: boolean;
          explanation: string | null;
        };
        Insert: {
          response_id: string;
          question_id: string;
          answered_yes: boolean;
          explanation?: string | null;
        };
        Update: Partial<{
          response_id: string;
          question_id: string;
          answered_yes: boolean;
          explanation: string | null;
        }>;
        Relationships: [];
      };
      waiver_documents: {
        Row: {
          id: string;
          gym_id: string;
          version: number;
          is_active: boolean;
          title: string;
          file_path: string;
          file_url: string;
          published_by: string | null;
          published_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          version: number;
          is_active?: boolean;
          title?: string;
          file_path: string;
          file_url: string;
          published_by?: string | null;
          published_at?: string;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          version: number;
          is_active: boolean;
          title: string;
          file_path: string;
          file_url: string;
          published_by: string | null;
          published_at: string;
        }>;
        Relationships: [];
      };
      waiver_signatures: {
        Row: {
          id: string;
          gym_id: string;
          profile_id: string;
          waiver_id: string;
          signature: Json;
          signed_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          profile_id: string;
          waiver_id: string;
          signature: Json;
          signed_at?: string;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          profile_id: string;
          waiver_id: string;
          signature: Json;
          signed_at: string;
        }>;
        Relationships: [];
      };
      staff_alerts: {
        Row: {
          id: string;
          gym_id: string;
          kind: StaffAlertKind;
          subject_profile_id: string | null;
          related_id: string | null;
          created_at: string;
          acknowledged_by: string | null;
          acknowledged_at: string | null;
        };
        Insert: {
          id?: string;
          gym_id: string;
          kind: StaffAlertKind;
          subject_profile_id?: string | null;
          related_id?: string | null;
          created_at?: string;
          acknowledged_by?: string | null;
          acknowledged_at?: string | null;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          kind: StaffAlertKind;
          subject_profile_id: string | null;
          related_id: string | null;
          created_at: string;
          acknowledged_by: string | null;
          acknowledged_at: string | null;
        }>;
        Relationships: [];
      };
      member_injuries: {
        Row: {
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
        Insert: {
          id?: string;
          gym_id: string;
          profile_id: string;
          body_region: string;
          side?: InjurySide;
          description?: string | null;
          pain_level: number;
          movements_hurt?: string[];
          movements_ok?: string[];
          started_on?: string;
          status?: InjuryStatus;
          created_at?: string;
          updated_at?: string;
          resolved_at?: string | null;
        };
        Update: Partial<{
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
        }>;
        Relationships: [];
      };
      injury_updates: {
        Row: {
          id: string;
          injury_id: string;
          gym_id: string;
          profile_id: string;
          pain_level: number;
          feeling: InjuryFeeling | null;
          status: InjuryStatus;
          note: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          injury_id: string;
          gym_id: string;
          profile_id: string;
          pain_level: number;
          feeling?: InjuryFeeling | null;
          status: InjuryStatus;
          note?: string | null;
          created_at?: string;
        };
        Update: Partial<{
          id: string;
          injury_id: string;
          gym_id: string;
          profile_id: string;
          pain_level: number;
          feeling: InjuryFeeling | null;
          status: InjuryStatus;
          note: string | null;
          created_at: string;
        }>;
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          full_name: string | null;
          avatar_url: string | null;
          date_of_birth: string | null;
          managed: boolean;
          created_at: string;
        };
        Insert: {
          id: string;
          full_name?: string | null;
          avatar_url?: string | null;
          date_of_birth?: string | null;
          managed?: boolean;
          created_at?: string;
        };
        Update: Partial<{
          id: string;
          full_name: string | null;
          avatar_url: string | null;
          date_of_birth: string | null;
          managed: boolean;
          created_at: string;
        }>;
        Relationships: [];
      };
      guardianships: {
        Row: {
          id: string;
          guardian_profile_id: string;
          dependent_profile_id: string;
          gym_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          guardian_profile_id: string;
          dependent_profile_id: string;
          gym_id: string;
          created_at?: string;
        };
        Update: Partial<{
          id: string;
          guardian_profile_id: string;
          dependent_profile_id: string;
          gym_id: string;
          created_at: string;
        }>;
        Relationships: [];
      };
      member_consents: {
        Row: {
          id: string;
          gym_id: string;
          profile_id: string;
          policy_version: string;
          lawful_basis: string;
          consented_at: string;
          guardian_name: string | null;
          guardian_contact: string | null;
        };
        Insert: {
          id?: string;
          gym_id: string;
          profile_id: string;
          policy_version: string;
          lawful_basis?: string;
          consented_at?: string;
          guardian_name?: string | null;
          guardian_contact?: string | null;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          profile_id: string;
          policy_version: string;
          lawful_basis: string;
          consented_at: string;
          guardian_name: string | null;
          guardian_contact: string | null;
        }>;
        Relationships: [];
      };
      health_data_access_log: {
        Row: {
          id: string;
          gym_id: string;
          actor_id: string | null;
          subject_profile_id: string | null;
          action: 'view' | 'erase' | 'purge';
          surface: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          actor_id?: string | null;
          subject_profile_id?: string | null;
          action: 'view' | 'erase' | 'purge';
          surface?: string | null;
          created_at?: string;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          actor_id: string | null;
          subject_profile_id: string | null;
          action: 'view' | 'erase' | 'purge';
          surface: string | null;
          created_at: string;
        }>;
        Relationships: [];
      };
      gym_memberships: {
        Row: {
          id: string;
          gym_id: string;
          profile_id: string;
          role: GymRole;
          health_flag: boolean;
          emergency_contact: string | null;
          par_q_id: string | null;
          left_at: string | null;
          created_at: string;
          appear_in_leaderboards: boolean;
          require_membership_to_book: boolean | null;
        };
        Insert: {
          id?: string;
          gym_id: string;
          profile_id: string;
          role: GymRole;
          health_flag?: boolean;
          emergency_contact?: string | null;
          par_q_id?: string | null;
          left_at?: string | null;
          created_at?: string;
          appear_in_leaderboards?: boolean;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          profile_id: string;
          role: GymRole;
          health_flag: boolean;
          emergency_contact: string | null;
          par_q_id: string | null;
          left_at: string | null;
          created_at: string;
          appear_in_leaderboards: boolean;
          require_membership_to_book: boolean | null;
        }>;
        Relationships: [
          {
            foreignKeyName: 'gym_memberships_gym_id_fkey';
            columns: ['gym_id'];
            referencedRelation: 'gyms';
            referencedColumns: ['id'];
          },
        ];
      };
      invite_codes: {
        Row: {
          id: string;
          gym_id: string;
          code: string;
          role: GymRole;
          created_by: string;
          expires_at: string | null;
          used_by: string | null;
          used_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          code: string;
          role?: GymRole;
          created_by: string;
          expires_at?: string | null;
          used_by?: string | null;
          used_at?: string | null;
          created_at?: string;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          code: string;
          role: GymRole;
          created_by: string;
          expires_at: string | null;
          used_by: string | null;
          used_at: string | null;
          created_at: string;
        }>;
        Relationships: [];
      };
      gym_hours: {
        Row: {
          id: string;
          gym_id: string;
          day_of_week: number;
          opens_at: string;
          closes_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          day_of_week: number;
          opens_at: string;
          closes_at: string;
          created_at?: string;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          day_of_week: number;
          opens_at: string;
          closes_at: string;
          created_at: string;
        }>;
        Relationships: [];
      };
      class_sessions: {
        Row: {
          id: string;
          gym_id: string;
          name: string;
          coach_id: string | null;
          starts_at: string;
          duration_minutes: number;
          capacity: number;
          notes: string | null;
          created_by: string;
          created_at: string;
          class_type_id: string | null;
          recurrence_id: string | null;
          location: string | null;
        };
        Insert: {
          id?: string;
          gym_id: string;
          name: string;
          coach_id?: string | null;
          starts_at: string;
          duration_minutes?: number;
          capacity?: number;
          notes?: string | null;
          created_by: string;
          created_at?: string;
          class_type_id?: string | null;
          recurrence_id?: string | null;
          location?: string | null;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          name: string;
          coach_id: string | null;
          starts_at: string;
          duration_minutes: number;
          capacity: number;
          notes: string | null;
          created_by: string;
          created_at: string;
          class_type_id: string | null;
          recurrence_id: string | null;
          location: string | null;
        }>;
        Relationships: [];
      };
      chat_turns: {
        Row: {
          id: string;
          gym_id: string;
          profile_id: string;
          role: 'owner' | 'gym';
          text: string;
          subject_profile_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          profile_id: string;
          role: 'owner' | 'gym';
          text: string;
          subject_profile_id?: string | null;
          created_at?: string;
        };
        Update: {
          subject_profile_id?: string | null;
        };
        Relationships: [];
      };
      class_types: {
        Row: {
          id: string;
          gym_id: string;
          name: string;
          color: string;
          archived_at: string | null;
          created_at: string;
          default_capacity: number | null;
          coach_required: boolean;
          unsupervised_label: string;
          booking_window_hours_ahead: number | null;
          booking_cutoff_minutes_before: number | null;
          cancel_cutoff_minutes_before: number | null;
          cancel_cutoff_mode: 'relative' | 'day_before' | null;
          cancel_cutoff_time: string | null;
          cancel_cutoff_days_before: number | null;
        };
        Insert: {
          id?: string;
          gym_id: string;
          name: string;
          color: string;
          archived_at?: string | null;
          created_at?: string;
          default_capacity?: number | null;
          coach_required?: boolean;
          unsupervised_label?: string;
          booking_window_hours_ahead?: number | null;
          booking_cutoff_minutes_before?: number | null;
          cancel_cutoff_minutes_before?: number | null;
          cancel_cutoff_mode?: 'relative' | 'day_before' | null;
          cancel_cutoff_time?: string | null;
          cancel_cutoff_days_before?: number | null;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          name: string;
          color: string;
          archived_at: string | null;
          created_at: string;
          default_capacity: number | null;
          coach_required: boolean;
          unsupervised_label: string;
          booking_window_hours_ahead: number | null;
          booking_cutoff_minutes_before: number | null;
          cancel_cutoff_minutes_before: number | null;
          cancel_cutoff_mode: 'relative' | 'day_before' | null;
          cancel_cutoff_time: string | null;
          cancel_cutoff_days_before: number | null;
        }>;
        Relationships: [];
      };
      class_recurrences: {
        Row: {
          id: string;
          gym_id: string;
          class_type_id: string;
          days_of_week: number[];
          times: string[];
          duration_minutes: number;
          capacity: number;
          notes: string | null;
          starts_on: string;
          ends_on: string | null;
          tz: string;
          materialized_until: string | null;
          created_by: string;
          created_at: string;
          location: string | null;
        };
        Insert: {
          id?: string;
          gym_id: string;
          class_type_id: string;
          days_of_week: number[];
          times: string[];
          duration_minutes: number;
          capacity: number;
          notes?: string | null;
          starts_on: string;
          ends_on?: string | null;
          tz?: string;
          materialized_until?: string | null;
          created_by: string;
          created_at?: string;
          location?: string | null;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          class_type_id: string;
          days_of_week: number[];
          times: string[];
          duration_minutes: number;
          capacity: number;
          notes: string | null;
          starts_on: string;
          ends_on: string | null;
          tz: string;
          materialized_until: string | null;
          created_by: string;
          created_at: string;
          location: string | null;
        }>;
        Relationships: [];
      };
      class_bookings: {
        Row: {
          id: string;
          gym_id: string;
          class_session_id: string;
          profile_id: string;
          created_at: string;
          attended_at: string | null;
          marked_by: string | null;
          no_show: boolean;
          no_show_marked_at: string | null;
          promoted_from_waitlist: boolean;
          used_entitlement_kind: 'comp_grant' | 'plan_subscription' | null;
          used_entitlement_id: string | null;
          booked_by_profile_id: string | null;
        };
        Insert: {
          id?: string;
          gym_id: string;
          class_session_id: string;
          profile_id: string;
          created_at?: string;
          attended_at?: string | null;
          marked_by?: string | null;
          no_show?: boolean;
          no_show_marked_at?: string | null;
          promoted_from_waitlist?: boolean;
          used_entitlement_kind?: 'comp_grant' | 'plan_subscription' | null;
          used_entitlement_id?: string | null;
          booked_by_profile_id?: string | null;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          class_session_id: string;
          profile_id: string;
          created_at: string;
          attended_at: string | null;
          marked_by: string | null;
          no_show: boolean;
          no_show_marked_at: string | null;
          promoted_from_waitlist: boolean;
          used_entitlement_kind: 'comp_grant' | 'plan_subscription' | null;
          used_entitlement_id: string | null;
          booked_by_profile_id: string | null;
        }>;
        Relationships: [];
      };
      class_programming: {
        Row: {
          id: string;
          gym_id: string;
          class_type_id: string;
          date: string;
          sections: Json;
          author_id: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          class_type_id: string;
          date: string;
          sections?: Json;
          author_id: string;
          updated_at?: string;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          class_type_id: string;
          date: string;
          sections: Json;
          author_id: string;
          updated_at: string;
        }>;
        Relationships: [];
      };
      member_programming: {
        Row: {
          id: string;
          gym_id: string;
          profile_id: string;
          date: string;
          sections: Json;
          author_id: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          profile_id: string;
          date: string;
          sections?: Json;
          author_id: string;
          updated_at?: string;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          profile_id: string;
          date: string;
          sections: Json;
          author_id: string;
          updated_at: string;
        }>;
        Relationships: [];
      };
      member_programming_access: {
        Row: {
          gym_id: string;
          profile_id: string;
          mode: 'free' | 'paid';
          store_product_id: string | null;
          updated_by: string | null;
          updated_at: string;
        };
        Insert: {
          gym_id: string;
          profile_id: string;
          mode?: 'free' | 'paid';
          store_product_id?: string | null;
          updated_by?: string | null;
          updated_at?: string;
        };
        Update: Partial<{
          gym_id: string;
          profile_id: string;
          mode: 'free' | 'paid';
          store_product_id: string | null;
          updated_by: string | null;
          updated_at: string;
        }>;
        Relationships: [];
      };
      member_programming_files: {
        Row: {
          id: string;
          gym_id: string;
          profile_id: string;
          title: string;
          file_path: string;
          uploaded_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          profile_id: string;
          title: string;
          file_path: string;
          uploaded_by?: string | null;
          created_at?: string;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          profile_id: string;
          title: string;
          file_path: string;
          uploaded_by: string | null;
          created_at: string;
        }>;
        Relationships: [];
      };
      membership_plans: {
        Row: {
          plan_id: string;
          gym_id: string;
          name: string;
          kind: MembershipPlanKind;
          credit_count: number | null;
          period_length: string | null;
          monthly_price_cents: number | null;
          notice_period_days: number | null;
          stripe_price_id: string | null;
          includes_individual_programming: boolean;
          archived_at: string | null;
          created_at: string;
        };
        Insert: {
          plan_id?: string;
          gym_id: string;
          name: string;
          kind: MembershipPlanKind;
          credit_count?: number | null;
          period_length?: string | null;
          monthly_price_cents?: number | null;
          notice_period_days?: number | null;
          stripe_price_id?: string | null;
          includes_individual_programming?: boolean;
          archived_at?: string | null;
          created_at?: string;
        };
        Update: Partial<{
          plan_id: string;
          gym_id: string;
          name: string;
          kind: MembershipPlanKind;
          credit_count: number | null;
          period_length: string | null;
          monthly_price_cents: number | null;
          notice_period_days: number | null;
          stripe_price_id: string | null;
          includes_individual_programming: boolean;
          archived_at: string | null;
          created_at: string;
        }>;
        Relationships: [];
      };
      plan_class_types: {
        Row: {
          plan_id: string;
          class_type_id: string;
        };
        Insert: {
          plan_id: string;
          class_type_id: string;
        };
        Update: Partial<{
          plan_id: string;
          class_type_id: string;
        }>;
        Relationships: [];
      };
      member_contact_details: {
        Row: {
          profile_id: string;
          phone: string | null;
          updated_at: string;
        };
        Insert: {
          profile_id: string;
          phone?: string | null;
          updated_at?: string;
        };
        Update: Partial<{
          phone: string | null;
          updated_at: string;
        }>;
        Relationships: [];
      };
      plan_subscription_dunning: {
        Row: {
          plan_subscription_id: string;
          profile_id: string;
          gym_id: string;
          past_due_since: string;
          payment_failure_count: number;
          last_payment_error: string | null;
          next_payment_attempt: string | null;
          updated_at: string;
        };
        Insert: {
          plan_subscription_id: string;
          profile_id: string;
          gym_id: string;
          past_due_since?: string;
          payment_failure_count?: number;
          last_payment_error?: string | null;
          next_payment_attempt?: string | null;
          updated_at?: string;
        };
        Update: Partial<{
          past_due_since: string;
          payment_failure_count: number;
          last_payment_error: string | null;
          next_payment_attempt: string | null;
          updated_at: string;
        }>;
        Relationships: [];
      };
      membership_invoice_links: {
        Row: {
          plan_subscription_id: string;
          profile_id: string;
          gym_id: string;
          invoice_url: string;
          updated_at: string;
        };
        Insert: {
          plan_subscription_id: string;
          profile_id: string;
          gym_id: string;
          invoice_url: string;
          updated_at?: string;
        };
        Update: Partial<{ invoice_url: string; updated_at: string }>;
        Relationships: [];
      };
      plan_subscriptions: {
        Row: {
          id: string;
          gym_membership_id: string;
          profile_id: string;
          gym_id: string;
          plan_id: string;
          status: PlanSubState;
          credit_balance: number | null;
          period_resets_at: string | null;
          paid_period_end: string | null;
          stripe_subscription_id: string | null;
          awaiting_payment_authentication: boolean;
          cancelled_at: string | null;
          price_cents: number | null;
          priority: number;
          imported_legacy: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          gym_membership_id: string;
          profile_id: string;
          gym_id: string;
          plan_id: string;
          status: PlanSubState;
          credit_balance?: number | null;
          period_resets_at?: string | null;
          paid_period_end?: string | null;
          stripe_subscription_id?: string | null;
          awaiting_payment_authentication?: boolean;
          cancelled_at?: string | null;
          price_cents?: number | null;
          priority?: number;
          imported_legacy?: boolean;
          created_at?: string;
        };
        Update: Partial<{
          id: string;
          gym_membership_id: string;
          profile_id: string;
          gym_id: string;
          plan_id: string;
          status: PlanSubState;
          credit_balance: number | null;
          period_resets_at: string | null;
          paid_period_end: string | null;
          stripe_subscription_id: string | null;
          awaiting_payment_authentication: boolean;
          cancelled_at: string | null;
          price_cents: number | null;
          priority: number;
          imported_legacy: boolean;
          created_at: string;
        }>;
        Relationships: [];
      };
      coach_tasks: {
        Row: {
          id: string;
          gym_id: string;
          assigned_to: string;
          created_by: string;
          target_profile: string | null;
          title: string;
          notes: string | null;
          status: 'open' | 'done' | 'cancelled';
          due_date: string | null;
          completed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          assigned_to: string;
          created_by: string;
          target_profile?: string | null;
          title: string;
          notes?: string | null;
          status?: 'open' | 'done' | 'cancelled';
          due_date?: string | null;
          completed_at?: string | null;
          created_at?: string;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          assigned_to: string;
          created_by: string;
          target_profile: string | null;
          title: string;
          notes: string | null;
          status: 'open' | 'done' | 'cancelled';
          due_date: string | null;
          completed_at: string | null;
          created_at: string;
        }>;
        Relationships: [];
      };
      cover_requests: {
        Row: {
          id: string;
          gym_id: string;
          requested_by: string;
          range_start: string;
          range_end: string;
          notes: string | null;
          status: 'open' | 'partial' | 'claimed' | 'cancelled' | 'expired';
          created_at: string;
          cancelled_at: string | null;
          requested_start: string | null;
          requested_end: string | null;
        };
        Insert: {
          id?: string;
          gym_id: string;
          requested_by: string;
          range_start: string;
          range_end: string;
          notes?: string | null;
          status?: 'open' | 'partial' | 'claimed' | 'cancelled' | 'expired';
          created_at?: string;
          cancelled_at?: string | null;
          requested_start?: string | null;
          requested_end?: string | null;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          requested_by: string;
          range_start: string;
          range_end: string;
          notes: string | null;
          status: 'open' | 'partial' | 'claimed' | 'cancelled' | 'expired';
          created_at: string;
          cancelled_at: string | null;
          requested_start: string | null;
          requested_end: string | null;
        }>;
        Relationships: [];
      };
      gym_closures: {
        Row: {
          id: string;
          gym_id: string;
          starts_on: string;
          ends_on: string;
          reason: string | null;
          created_by: string;
          created_at: string;
          lifted_at: string | null;
          lifted_by: string | null;
        };
        Insert: {
          id?: string;
          gym_id: string;
          starts_on: string;
          ends_on: string;
          reason?: string | null;
          created_by: string;
          created_at?: string;
          lifted_at?: string | null;
          lifted_by?: string | null;
        };
        Update: Partial<{
          reason: string | null;
          lifted_at: string | null;
          lifted_by: string | null;
        }>;
        Relationships: [];
      };
      closure_cancelled_bookings: {
        Row: {
          id: string;
          closure_id: string;
          gym_id: string;
          profile_id: string;
          recurrence_id: string | null;
          starts_at: string;
          class_type_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          closure_id: string;
          gym_id: string;
          profile_id: string;
          recurrence_id?: string | null;
          starts_at: string;
          class_type_id?: string | null;
          created_at?: string;
        };
        Update: Partial<{ recurrence_id: string | null }>;
        Relationships: [];
      };
      payment_notifications: {
        Row: {
          id: string;
          gym_id: string;
          plan_subscription_id: string;
          recipient_profile_id: string | null;
          kind: 'payment_failed' | 'payment_final_notice';
          channel: 'email' | 'in_app';
          recipient: string | null;
          body: string;
          status: 'queued' | 'sent' | 'failed' | 'skipped' | 'read';
          error: string | null;
          idempotency_key: string;
          attempts: number;
          created_at: string;
          sent_at: string | null;
          read_at: string | null;
        };
        Insert: {
          id?: string;
          gym_id: string;
          plan_subscription_id: string;
          recipient_profile_id?: string | null;
          kind: 'payment_failed' | 'payment_final_notice';
          channel: 'email' | 'in_app';
          recipient?: string | null;
          body: string;
          status?: 'queued' | 'sent' | 'failed' | 'skipped' | 'read';
          error?: string | null;
          idempotency_key: string;
          attempts?: number;
          created_at?: string;
          sent_at?: string | null;
          read_at?: string | null;
        };
        Update: Partial<{
          status: 'queued' | 'sent' | 'failed' | 'skipped' | 'read';
          error: string | null;
          attempts: number;
          sent_at: string | null;
          read_at: string | null;
        }>;
        Relationships: [];
      };
      class_change_notifications: {
        Row: {
          id: string;
          gym_id: string;
          closure_id: string | null;
          kind:
            | 'gym_closed'
            | 'classes_rescheduled'
            | 'classes_reopened'
            | 'class_cancelled'
            | 'class_coach_changed';
          channel: 'email' | 'in_app';
          recipient: string | null;
          recipient_profile_id: string | null;
          body: string;
          status: 'queued' | 'sent' | 'failed' | 'skipped' | 'read';
          error: string | null;
          idempotency_key: string;
          created_at: string;
          sent_at: string | null;
          read_at: string | null;
        };
        Insert: {
          id?: string;
          gym_id: string;
          closure_id?: string | null;
          kind:
            | 'gym_closed'
            | 'classes_rescheduled'
            | 'classes_reopened'
            | 'class_cancelled'
            | 'class_coach_changed';
          channel: 'email' | 'in_app';
          recipient?: string | null;
          recipient_profile_id?: string | null;
          body: string;
          status?: 'queued' | 'sent' | 'failed' | 'skipped' | 'read';
          error?: string | null;
          idempotency_key: string;
          created_at?: string;
          sent_at?: string | null;
          read_at?: string | null;
        };
        Update: Partial<{
          status: 'queued' | 'sent' | 'failed' | 'skipped' | 'read';
          error: string | null;
          sent_at: string | null;
          read_at: string | null;
        }>;
        Relationships: [];
      };
      cover_notifications: {
        Row: {
          id: string;
          gym_id: string;
          request_id: string;
          offer_id: string | null;
          kind: 'cover_requested' | 'cover_claimed' | 'cover_uncovered';
          channel: 'email' | 'in_app';
          recipient: string | null;
          recipient_profile_id: string | null;
          status: 'queued' | 'sent' | 'failed' | 'skipped' | 'read';
          error: string | null;
          idempotency_key: string;
          created_at: string;
          sent_at: string | null;
          read_at: string | null;
        };
        Insert: {
          id?: string;
          gym_id: string;
          request_id: string;
          offer_id?: string | null;
          kind: 'cover_requested' | 'cover_claimed' | 'cover_uncovered';
          channel: 'email' | 'in_app';
          recipient?: string | null;
          recipient_profile_id?: string | null;
          status?: 'queued' | 'sent' | 'failed' | 'skipped' | 'read';
          error?: string | null;
          idempotency_key: string;
          created_at?: string;
          sent_at?: string | null;
          read_at?: string | null;
        };
        Update: Partial<{
          status: 'queued' | 'sent' | 'failed' | 'skipped' | 'read';
          error: string | null;
          sent_at: string | null;
          read_at: string | null;
        }>;
        Relationships: [];
      };
      cover_request_sessions: {
        Row: {
          id: string;
          request_id: string;
          class_session_id: string;
          original_coach_id: string;
          claimed_by: string | null;
          claimed_at: string | null;
          gym_id: string;
        };
        Insert: {
          id?: string;
          request_id: string;
          class_session_id: string;
          original_coach_id: string;
          claimed_by?: string | null;
          claimed_at?: string | null;
          gym_id: string;
        };
        Update: Partial<{
          id: string;
          request_id: string;
          class_session_id: string;
          original_coach_id: string;
          claimed_by: string | null;
          claimed_at: string | null;
          gym_id: string;
        }>;
        Relationships: [];
      };
      sop_documents: {
        Row: {
          id: string;
          gym_id: string;
          title: string;
          body_markdown: string;
          category: string | null;
          author_id: string;
          updated_at: string;
          archived_at: string | null;
        };
        Insert: {
          id?: string;
          gym_id: string;
          title: string;
          body_markdown?: string;
          category?: string | null;
          author_id: string;
          updated_at?: string;
          archived_at?: string | null;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          title: string;
          body_markdown: string;
          category: string | null;
          author_id: string;
          updated_at: string;
          archived_at: string | null;
        }>;
        Relationships: [];
      };
      gym_role_capabilities: {
        Row: {
          gym_id: string;
          role: GymRole;
          capability: string;
          enabled: boolean;
          updated_by: string | null;
          updated_at: string;
        };
        Insert: {
          gym_id: string;
          role: GymRole;
          capability: string;
          enabled: boolean;
          updated_by?: string | null;
          updated_at?: string;
        };
        Update: Partial<{
          gym_id: string;
          role: GymRole;
          capability: string;
          enabled: boolean;
          updated_by: string | null;
          updated_at: string;
        }>;
        Relationships: [];
      };
      gym_member_capabilities: {
        Row: {
          gym_id: string;
          profile_id: string;
          capability: string;
          enabled: boolean;
          updated_by: string | null;
          updated_at: string;
        };
        Insert: {
          gym_id: string;
          profile_id: string;
          capability: string;
          enabled: boolean;
          updated_by?: string | null;
          updated_at?: string;
        };
        Update: Partial<{
          gym_id: string;
          profile_id: string;
          capability: string;
          enabled: boolean;
          updated_by: string | null;
          updated_at: string;
        }>;
        Relationships: [];
      };
      gym_insight_targets: {
        Row: {
          gym_id: string;
          metric: 'intros_new' | 'conversions' | 'retention';
          period: 'week' | 'month' | 'quarter' | 'year';
          target_value: number;
          unit: 'count' | 'rate';
          updated_by: string;
          updated_at: string;
        };
        Insert: {
          gym_id: string;
          metric: 'intros_new' | 'conversions' | 'retention';
          period: 'week' | 'month' | 'quarter' | 'year';
          target_value: number;
          unit?: 'count' | 'rate';
          updated_by: string;
          updated_at?: string;
        };
        Update: Partial<{
          gym_id: string;
          metric: 'intros_new' | 'conversions' | 'retention';
          period: 'week' | 'month' | 'quarter' | 'year';
          target_value: number;
          unit: 'count' | 'rate';
          updated_by: string;
          updated_at: string;
        }>;
        Relationships: [];
      };
      member_tags: {
        Row: {
          id: string;
          gym_id: string;
          profile_id: string;
          label: string;
          color: string;
          source: 'manual' | 'auto';
          rule_id: string | null;
          member_visible: boolean;
          created_by: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          profile_id: string;
          label: string;
          color: string;
          source: 'manual' | 'auto';
          rule_id?: string | null;
          member_visible?: boolean;
          created_by: string;
          created_at?: string;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          profile_id: string;
          label: string;
          color: string;
          source: 'manual' | 'auto';
          rule_id: string | null;
          member_visible: boolean;
          created_by: string;
          created_at: string;
        }>;
        Relationships: [];
      };
      tag_rules: {
        Row: {
          id: string;
          gym_id: string;
          label: string;
          color: string;
          predicate_kind:
            | 'intro'
            | 'expiring_soon'
            | 'expired'
            | 'paying'
            | 'inactive'
            | 'never_paid'
            | 'booked_class_type'
            | 'attended_class_type'
            | 'no_recent_attendance'
            | 'on_plan'
            | 'cancelling'
            | 'joined_within';
          threshold_days: number | null;
          class_type_id: string | null;
          plan_id: string | null;
          member_visible: boolean;
          active: boolean;
          created_by: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          label: string;
          color: string;
          predicate_kind:
            | 'intro'
            | 'expiring_soon'
            | 'expired'
            | 'paying'
            | 'inactive'
            | 'never_paid'
            | 'booked_class_type'
            | 'attended_class_type'
            | 'no_recent_attendance'
            | 'on_plan'
            | 'cancelling'
            | 'joined_within';
          threshold_days?: number | null;
          class_type_id?: string | null;
          plan_id?: string | null;
          member_visible?: boolean;
          active?: boolean;
          created_by: string;
          created_at?: string;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          label: string;
          color: string;
          predicate_kind:
            | 'intro'
            | 'expiring_soon'
            | 'expired'
            | 'paying'
            | 'inactive'
            | 'never_paid'
            | 'booked_class_type'
            | 'attended_class_type'
            | 'no_recent_attendance'
            | 'on_plan'
            | 'cancelling'
            | 'joined_within';
          threshold_days: number | null;
          class_type_id: string | null;
          plan_id: string | null;
          member_visible: boolean;
          active: boolean;
          created_by: string;
          created_at: string;
        }>;
        Relationships: [];
      };
      comp_grants: {
        Row: {
          grant_id: string;
          gym_id: string;
          profile_id: string;
          starts_at: string;
          ends_at: string;
          credits_total: number | null;
          credits_remaining: number | null;
          class_type_allowlist: string[];
          granted_by: string;
          reason: string | null;
          revoked_at: string | null;
          created_at: string;
        };
        Insert: {
          grant_id?: string;
          gym_id: string;
          profile_id: string;
          starts_at: string;
          ends_at: string;
          credits_total?: number | null;
          credits_remaining?: number | null;
          class_type_allowlist?: string[];
          granted_by: string;
          reason?: string | null;
          revoked_at?: string | null;
          created_at?: string;
        };
        Update: Partial<{
          grant_id: string;
          gym_id: string;
          profile_id: string;
          starts_at: string;
          ends_at: string;
          credits_total: number | null;
          credits_remaining: number | null;
          class_type_allowlist: string[];
          granted_by: string;
          reason: string | null;
          revoked_at: string | null;
          created_at: string;
        }>;
        Relationships: [];
      };
      class_waitlist: {
        Row: {
          id: string;
          gym_id: string;
          class_session_id: string;
          profile_id: string;
          position: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          class_session_id: string;
          profile_id: string;
          position: number;
          created_at?: string;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          class_session_id: string;
          profile_id: string;
          position: number;
          created_at: string;
        }>;
        Relationships: [];
      };
      onboarding_responses: {
        Row: {
          id: string;
          gym_id: string;
          profile_id: string;
          question_key: string;
          question_text: string;
          answer: string;
          display_order: number;
          answered_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          profile_id: string;
          question_key: string;
          question_text: string;
          answer: string;
          display_order: number;
          answered_at?: string;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          profile_id: string;
          question_key: string;
          question_text: string;
          answer: string;
          display_order: number;
          answered_at: string;
        }>;
        Relationships: [];
      };
      tracked_workouts: {
        Row: {
          id: string;
          gym_id: string | null;
          profile_id: string;
          class_session_id: string | null;
          performed_at: string;
          title: string | null;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          gym_id?: string | null;
          profile_id: string;
          class_session_id?: string | null;
          performed_at?: string;
          title?: string | null;
          notes?: string | null;
          created_at?: string;
        };
        Update: Partial<{
          id: string;
          gym_id: string | null;
          profile_id: string;
          class_session_id: string | null;
          performed_at: string;
          title: string | null;
          notes: string | null;
          created_at: string;
        }>;
        Relationships: [];
      };
      tracked_movement_results: {
        Row: {
          id: string;
          gym_id: string | null;
          profile_id: string;
          workout_id: string;
          movement_key: string;
          track_key: string;
          value_numeric: number | null;
          value_seconds: number | null;
          value_unit: string | null;
          notes: string | null;
          performed_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          gym_id?: string | null;
          profile_id: string;
          workout_id: string;
          movement_key: string;
          track_key: string;
          value_numeric?: number | null;
          value_seconds?: number | null;
          value_unit?: string | null;
          notes?: string | null;
          performed_at?: string;
          created_at?: string;
        };
        Update: Partial<{
          id: string;
          gym_id: string | null;
          profile_id: string;
          workout_id: string;
          movement_key: string;
          track_key: string;
          value_numeric: number | null;
          value_seconds: number | null;
          value_unit: string | null;
          notes: string | null;
          performed_at: string;
          created_at: string;
        }>;
        Relationships: [];
      };
      athlete_subscriptions: {
        Row: {
          profile_id: string;
          status: 'active' | 'cancelled';
          source: string;
          activated_at: string;
          current_period_end: string | null;
          cancelled_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          profile_id: string;
          status?: 'active' | 'cancelled';
          source?: string;
          activated_at?: string;
          current_period_end?: string | null;
          cancelled_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<{
          profile_id: string;
          status: 'active' | 'cancelled';
          source: string;
          activated_at: string;
          current_period_end: string | null;
          cancelled_at: string | null;
          created_at: string;
          updated_at: string;
        }>;
        Relationships: [];
      };
      tracked_workout_sections: {
        Row: {
          id: string;
          gym_id: string;
          profile_id: string;
          workout_id: string;
          source_programming_id: string | null;
          source_member_programming_id: string | null;
          source_section_index: number | null;
          section_category: string;
          section_format: string;
          title: string | null;
          body: string | null;
          notes: string | null;
          sort_order: number;
          total_time_seconds: number | null;
          total_rounds: number | null;
          total_extra_reps: number | null;
          total_distance_m: number | null;
          total_calories: number | null;
          did_not_finish: boolean | null;
          free_text_result: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          profile_id: string;
          workout_id: string;
          source_programming_id?: string | null;
          source_member_programming_id?: string | null;
          source_section_index?: number | null;
          section_category: string;
          section_format: string;
          title?: string | null;
          body?: string | null;
          notes?: string | null;
          sort_order?: number;
          total_time_seconds?: number | null;
          total_rounds?: number | null;
          total_extra_reps?: number | null;
          total_distance_m?: number | null;
          total_calories?: number | null;
          did_not_finish?: boolean | null;
          free_text_result?: string | null;
          created_at?: string;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          profile_id: string;
          workout_id: string;
          source_programming_id: string | null;
          source_member_programming_id: string | null;
          source_section_index: number | null;
          section_category: string;
          section_format: string;
          title: string | null;
          body: string | null;
          notes: string | null;
          sort_order: number;
          total_time_seconds: number | null;
          total_rounds: number | null;
          total_extra_reps: number | null;
          total_distance_m: number | null;
          total_calories: number | null;
          did_not_finish: boolean | null;
          free_text_result: string | null;
          created_at: string;
        }>;
        Relationships: [];
      };
      tracked_section_entries: {
        Row: {
          id: string;
          gym_id: string;
          profile_id: string;
          section_id: string;
          entry_index: number;
          round_index: number | null;
          label: string | null;
          weight_numeric: number | null;
          weight_unit: string | null;
          reps: number | null;
          time_seconds: number | null;
          distance_numeric: number | null;
          distance_unit: string | null;
          calories: number | null;
          done: boolean | null;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          profile_id: string;
          section_id: string;
          entry_index: number;
          round_index?: number | null;
          label?: string | null;
          weight_numeric?: number | null;
          weight_unit?: string | null;
          reps?: number | null;
          time_seconds?: number | null;
          distance_numeric?: number | null;
          distance_unit?: string | null;
          calories?: number | null;
          done?: boolean | null;
          notes?: string | null;
          created_at?: string;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          profile_id: string;
          section_id: string;
          entry_index: number;
          round_index: number | null;
          label: string | null;
          weight_numeric: number | null;
          weight_unit: string | null;
          reps: number | null;
          time_seconds: number | null;
          distance_numeric: number | null;
          distance_unit: string | null;
          calories: number | null;
          done: boolean | null;
          notes: string | null;
          created_at: string;
        }>;
        Relationships: [];
      };
      tracked_hyrox_races: {
        Row: {
          id: string;
          gym_id: string;
          profile_id: string;
          workout_id: string;
          race_length: 'full' | 'half';
          race_type: string;
          division: string;
          gender_category: string;
          age_group: string | null;
          run_total_seconds: number;
          station_total_seconds: number;
          roxzone_total_seconds: number;
          total_seconds: number;
          performed_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          profile_id: string;
          workout_id: string;
          race_length: 'full' | 'half';
          race_type?: string;
          division?: string;
          gender_category: string;
          age_group?: string | null;
          run_total_seconds: number;
          station_total_seconds: number;
          roxzone_total_seconds: number;
          total_seconds: number;
          performed_at?: string;
          created_at?: string;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          profile_id: string;
          workout_id: string;
          race_length: 'full' | 'half';
          race_type: string;
          division: string;
          gender_category: string;
          age_group: string | null;
          run_total_seconds: number;
          station_total_seconds: number;
          roxzone_total_seconds: number;
          total_seconds: number;
          performed_at: string;
          created_at: string;
        }>;
        Relationships: [];
      };
      tracked_hyrox_splits: {
        Row: {
          id: string;
          gym_id: string;
          profile_id: string;
          race_id: string;
          segment_type: 'run' | 'station' | 'roxzone';
          segment_index: number;
          station_key: string | null;
          time_seconds: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          profile_id: string;
          race_id: string;
          segment_type: 'run' | 'station' | 'roxzone';
          segment_index: number;
          station_key?: string | null;
          time_seconds: number;
          created_at?: string;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          profile_id: string;
          race_id: string;
          segment_type: 'run' | 'station' | 'roxzone';
          segment_index: number;
          station_key: string | null;
          time_seconds: number;
          created_at: string;
        }>;
        Relationships: [];
      };
      tracked_section_movement_tags: {
        Row: {
          id: string;
          gym_id: string;
          profile_id: string;
          section_id: string;
          movement_key: string;
          track_key: string | null;
          performed_at: string;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          profile_id: string;
          section_id: string;
          movement_key: string;
          track_key?: string | null;
          performed_at: string;
          notes?: string | null;
          created_at?: string;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          profile_id: string;
          section_id: string;
          movement_key: string;
          track_key: string | null;
          performed_at: string;
          notes: string | null;
          created_at: string;
        }>;
        Relationships: [];
      };
      member_movement_preferences: {
        Row: {
          profile_id: string;
          term: string;
          movement_key: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          profile_id: string;
          term: string;
          movement_key: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<{
          movement_key: string;
          updated_at: string;
        }>;
        Relationships: [];
      };
      tracked_movement_favourites: {
        Row: {
          profile_id: string;
          movement_key: string;
          created_at: string;
        };
        Insert: {
          profile_id: string;
          movement_key: string;
          created_at?: string;
        };
        Update: Partial<{
          profile_id: string;
          movement_key: string;
          created_at: string;
        }>;
        Relationships: [];
      };
      tracked_group_favourites: {
        Row: {
          profile_id: string;
          group_key: string;
          created_at: string;
        };
        Insert: {
          profile_id: string;
          group_key: string;
          created_at?: string;
        };
        Update: Partial<{
          profile_id: string;
          group_key: string;
          created_at: string;
        }>;
        Relationships: [];
      };
      gym_comms_settings: {
        Row: {
          gym_id: string;
          from_name: string | null;
          reply_to: string | null;
          footer_business_name: string | null;
          footer_address: string | null;
          updated_by: string | null;
          updated_at: string;
        };
        Insert: {
          gym_id: string;
          from_name?: string | null;
          reply_to?: string | null;
          footer_business_name?: string | null;
          footer_address?: string | null;
          updated_by?: string | null;
          updated_at?: string;
        };
        Update: Partial<{
          gym_id: string;
          from_name: string | null;
          reply_to: string | null;
          footer_business_name: string | null;
          footer_address: string | null;
          updated_by: string | null;
          updated_at: string;
        }>;
        Relationships: [];
      };
      gym_stripe_accounts: {
        Row: {
          gym_id: string;
          stripe_account_id: string;
          connected_by: string | null;
          connected_at: string;
        };
        Insert: {
          gym_id: string;
          stripe_account_id: string;
          connected_by?: string | null;
          connected_at?: string;
        };
        Update: Partial<{
          gym_id: string;
          stripe_account_id: string;
          connected_by: string | null;
          connected_at: string;
        }>;
        Relationships: [];
      };
      billing_events: {
        Row: {
          provider: string;
          provider_event_id: string;
          provider_account_id: string | null;
          gym_id: string | null;
          plan_subscription_id: string | null;
          member_id: string;
          kind: string;
          amount_cents: number;
          currency: string;
          occurred_at: string;
          payload: Json;
        };
        Insert: {
          provider?: string;
          provider_event_id: string;
          provider_account_id?: string | null;
          gym_id?: string | null;
          plan_subscription_id?: string | null;
          member_id: string;
          kind: string;
          amount_cents: number;
          currency: string;
          occurred_at: string;
          payload: Json;
        };
        Update: Partial<{
          provider: string;
          provider_event_id: string;
          provider_account_id: string | null;
          gym_id: string | null;
          plan_subscription_id: string | null;
          member_id: string;
          kind: string;
          amount_cents: number;
          currency: string;
          occurred_at: string;
          payload: Json;
        }>;
        Relationships: [];
      };
      membership_change_requests: {
        Row: {
          id: string;
          gym_id: string;
          profile_id: string;
          plan_subscription_id: string;
          kind: 'cancel' | 'switch_plan';
          target_plan_id: string | null;
          status: 'pending' | 'approved' | 'rejected' | 'withdrawn';
          member_note: string | null;
          staff_note: string | null;
          decided_by: string | null;
          decided_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          profile_id: string;
          plan_subscription_id: string;
          kind: 'cancel' | 'switch_plan';
          target_plan_id?: string | null;
          status?: 'pending' | 'approved' | 'rejected' | 'withdrawn';
          member_note?: string | null;
          staff_note?: string | null;
          decided_by?: string | null;
          decided_at?: string | null;
          created_at?: string;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          profile_id: string;
          plan_subscription_id: string;
          kind: 'cancel' | 'switch_plan';
          target_plan_id: string | null;
          status: 'pending' | 'approved' | 'rejected' | 'withdrawn';
          member_note: string | null;
          staff_note: string | null;
          decided_by: string | null;
          decided_at: string | null;
          created_at: string;
        }>;
        Relationships: [];
      };
      email_audiences: {
        Row: {
          id: string;
          gym_id: string;
          name: string;
          definition: Json;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          name: string;
          definition?: Json;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          name: string;
          definition: Json;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        }>;
        Relationships: [];
      };
      email_automations: {
        Row: {
          id: string;
          gym_id: string;
          name: string;
          enabled: boolean;
          trigger_type:
            | 'member_joined'
            | 'member_first_class'
            | 'member_inactive'
            | 'lead_cold'
            | 'member_tagged';
          delay_minutes: number;
          params: Json;
          conditions: Json;
          send_hour: number | null;
          send_days: number[] | null;
          topic_id: string | null;
          subject: string;
          preheader: string;
          from_name: string | null;
          design: Json;
          compiled_html: string | null;
          compiled_text: string | null;
          created_by: string | null;
          updated_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          name?: string;
          enabled?: boolean;
          trigger_type?:
            | 'member_joined'
            | 'member_first_class'
            | 'member_inactive'
            | 'lead_cold'
            | 'member_tagged';
          delay_minutes?: number;
          params?: Json;
          conditions?: Json;
          send_hour?: number | null;
          send_days?: number[] | null;
          topic_id?: string | null;
          subject?: string;
          preheader?: string;
          from_name?: string | null;
          design?: Json;
          compiled_html?: string | null;
          compiled_text?: string | null;
          created_by?: string | null;
          updated_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<{
          name: string;
          enabled: boolean;
          trigger_type:
            | 'member_joined'
            | 'member_first_class'
            | 'member_inactive'
            | 'lead_cold'
            | 'member_tagged';
          delay_minutes: number;
          params: Json;
          conditions: Json;
          send_hour: number | null;
          send_days: number[] | null;
          topic_id: string | null;
          subject: string;
          preheader: string;
          from_name: string | null;
          design: Json;
          compiled_html: string | null;
          compiled_text: string | null;
          updated_by: string | null;
          updated_at: string;
        }>;
        Relationships: [];
      };
      email_automation_steps: {
        Row: {
          id: string;
          automation_id: string;
          gym_id: string;
          step_index: number;
          delay_minutes: number;
          send_hour: number | null;
          send_days: number[] | null;
          subject: string;
          preheader: string;
          from_name: string | null;
          design: Json;
          compiled_html: string | null;
          compiled_text: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          automation_id: string;
          gym_id: string;
          step_index?: number;
          delay_minutes?: number;
          send_hour?: number | null;
          send_days?: number[] | null;
          subject?: string;
          preheader?: string;
          from_name?: string | null;
          design?: Json;
          compiled_html?: string | null;
          compiled_text?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<{
          step_index: number;
          delay_minutes: number;
          send_hour: number | null;
          send_days: number[] | null;
          subject: string;
          preheader: string;
          from_name: string | null;
          design: Json;
          compiled_html: string | null;
          compiled_text: string | null;
          updated_at: string;
        }>;
        Relationships: [];
      };
      email_automation_runs: {
        Row: {
          id: string;
          gym_id: string;
          automation_id: string;
          step_id: string | null;
          subject_profile_id: string | null;
          lead_id: string | null;
          recipient_email: string;
          recipient_name: string | null;
          status: 'queued' | 'sent' | 'failed' | 'skipped' | 'suppressed';
          error: string | null;
          idempotency_key: string;
          scheduled_at: string | null;
          created_at: string;
          sent_at: string | null;
        };
        Insert: {
          id?: string;
          gym_id: string;
          automation_id: string;
          step_id?: string | null;
          subject_profile_id?: string | null;
          lead_id?: string | null;
          recipient_email: string;
          recipient_name?: string | null;
          status?: 'queued' | 'sent' | 'failed' | 'skipped' | 'suppressed';
          error?: string | null;
          idempotency_key: string;
          scheduled_at?: string | null;
          created_at?: string;
          sent_at?: string | null;
        };
        Update: Partial<{
          status: 'queued' | 'sent' | 'failed' | 'skipped' | 'suppressed';
          error: string | null;
          sent_at: string | null;
        }>;
        Relationships: [];
      };
      email_campaigns: {
        Row: {
          id: string;
          gym_id: string;
          created_by: string | null;
          title: string;
          subject: string;
          preheader: string;
          from_name: string | null;
          reply_to: string | null;
          status: 'draft' | 'scheduled' | 'sending' | 'sent' | 'failed' | 'cancelled';
          design: Json;
          audience: Json;
          audience_id: string | null;
          topic_id: string | null;
          compiled_html: string | null;
          compiled_text: string | null;
          scheduled_for: string | null;
          // Subject, variants, audience and topic as approved at schedule
          // time; only _send_due_campaign reads it (0193).
          scheduled_snapshot: Json | null;
          subject_variants: string[];
          sent_at: string | null;
          recipient_count: number;
          // Set by comms_apply_delivery_event the first time a real
          // delivery report lands (0229). False means unmeasured, which
          // is not the same fact as zero.
          delivery_tracked: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          created_by?: string | null;
          title?: string;
          subject?: string;
          preheader?: string;
          from_name?: string | null;
          reply_to?: string | null;
          status?: 'draft' | 'scheduled' | 'sending' | 'sent' | 'failed' | 'cancelled';
          design?: Json;
          audience?: Json;
          audience_id?: string | null;
          topic_id?: string | null;
          compiled_html?: string | null;
          compiled_text?: string | null;
          scheduled_for?: string | null;
          subject_variants?: string[];
          sent_at?: string | null;
          recipient_count?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<{
          subject_variants: string[];
          id: string;
          gym_id: string;
          created_by: string | null;
          title: string;
          subject: string;
          preheader: string;
          from_name: string | null;
          reply_to: string | null;
          status: 'draft' | 'scheduled' | 'sending' | 'sent' | 'failed' | 'cancelled';
          design: Json;
          audience: Json;
          audience_id: string | null;
          topic_id: string | null;
          compiled_html: string | null;
          compiled_text: string | null;
          scheduled_for: string | null;
          sent_at: string | null;
          recipient_count: number;
          created_at: string;
          updated_at: string;
        }>;
        Relationships: [];
      };
      email_campaign_recipients: {
        Row: {
          id: string;
          campaign_id: string;
          gym_id: string;
          profile_id: string | null;
          email: string;
          full_name: string | null;
          status: 'queued' | 'sent' | 'delivered' | 'simulated' | 'bounced' | 'failed' | 'skipped';
          error: string | null;
          provider_message_id: string | null;
          sent_at: string | null;
          delivered_at: string | null;
          first_opened_at: string | null;
          last_opened_at: string | null;
          open_count: number;
          first_clicked_at: string | null;
          last_clicked_at: string | null;
          click_count: number;
          unsubscribed_at: string | null;
          complained_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          campaign_id: string;
          gym_id: string;
          profile_id?: string | null;
          email: string;
          full_name?: string | null;
          status?: 'queued' | 'sent' | 'delivered' | 'simulated' | 'bounced' | 'failed' | 'skipped';
          error?: string | null;
          provider_message_id?: string | null;
          sent_at?: string | null;
          delivered_at?: string | null;
          first_opened_at?: string | null;
          last_opened_at?: string | null;
          open_count?: number;
          first_clicked_at?: string | null;
          last_clicked_at?: string | null;
          click_count?: number;
          unsubscribed_at?: string | null;
          complained_at?: string | null;
          created_at?: string;
        };
        Update: Partial<{
          id: string;
          campaign_id: string;
          gym_id: string;
          profile_id: string | null;
          email: string;
          full_name: string | null;
          status: 'queued' | 'sent' | 'delivered' | 'simulated' | 'bounced' | 'failed' | 'skipped';
          error: string | null;
          provider_message_id: string | null;
          sent_at: string | null;
          delivered_at: string | null;
          first_opened_at: string | null;
          last_opened_at: string | null;
          open_count: number;
          first_clicked_at: string | null;
          last_clicked_at: string | null;
          click_count: number;
          unsubscribed_at: string | null;
          complained_at: string | null;
          created_at: string;
        }>;
        Relationships: [];
      };
      email_events: {
        Row: {
          id: string;
          gym_id: string;
          campaign_id: string;
          recipient_id: string | null;
          kind:
            | 'queued'
            | 'sent'
            | 'delivered'
            | 'open'
            | 'click'
            | 'bounce'
            | 'complaint'
            | 'unsubscribe'
            | 'failed'
            | 'simulated';
          url: string | null;
          meta: Json | null;
          occurred_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          campaign_id: string;
          recipient_id?: string | null;
          kind:
            | 'queued'
            | 'sent'
            | 'delivered'
            | 'open'
            | 'click'
            | 'bounce'
            | 'complaint'
            | 'unsubscribe'
            | 'failed'
            | 'simulated';
          url?: string | null;
          meta?: Json | null;
          occurred_at?: string;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          campaign_id: string;
          recipient_id: string | null;
          kind:
            | 'queued'
            | 'sent'
            | 'delivered'
            | 'open'
            | 'click'
            | 'bounce'
            | 'complaint'
            | 'unsubscribe'
            | 'failed'
            | 'simulated';
          url: string | null;
          meta: Json | null;
          occurred_at: string;
        }>;
        Relationships: [];
      };
      email_assets: {
        Row: {
          id: string;
          gym_id: string;
          uploaded_by: string | null;
          path: string;
          url: string;
          file_name: string | null;
          byte_size: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          uploaded_by?: string | null;
          path: string;
          url: string;
          file_name?: string | null;
          byte_size?: number | null;
          created_at?: string;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          uploaded_by: string | null;
          path: string;
          url: string;
          file_name: string | null;
          byte_size: number | null;
          created_at: string;
        }>;
        Relationships: [];
      };
      email_unsubscribes: {
        Row: {
          id: string;
          gym_id: string;
          email: string;
          profile_id: string | null;
          campaign_id: string | null;
          topic_id: string | null;
          reason: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          email: string;
          profile_id?: string | null;
          campaign_id?: string | null;
          topic_id?: string | null;
          reason?: string | null;
          created_at?: string;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          email: string;
          profile_id: string | null;
          campaign_id: string | null;
          topic_id: string | null;
          reason: string | null;
          created_at: string;
        }>;
        Relationships: [];
      };
      // A gym, a route, a day, a number — and deliberately nothing else.
      // Written only by record_route_open; read by admins for their own
      // gym; purged at ninety days (0233).
      route_opens: {
        Row: {
          gym_id: string;
          route: string;
          day: string;
          opens: number;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      // Addresses that cannot be reached, kept apart from
      // email_unsubscribes on purpose (0229): "we cannot reach you" and
      // "you asked us to stop" are different facts. Written only by the
      // service role; staff may read one and delete one.
      email_suppressions: {
        Row: {
          id: string;
          gym_id: string;
          email: string;
          reason: 'hard_bounce' | 'complaint';
          detail: string | null;
          campaign_id: string | null;
          profile_id: string | null;
          first_seen_at: string;
          last_seen_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      gym_email_topics: {
        Row: {
          id: string;
          gym_id: string;
          label: string;
          description: string | null;
          sort_order: number;
          archived_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          label: string;
          description?: string | null;
          sort_order?: number;
          archived_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          label: string;
          description: string | null;
          sort_order: number;
          archived_at: string | null;
          created_at: string;
          updated_at: string;
        }>;
        Relationships: [];
      };
      gym_sending_domains: {
        Row: {
          gym_id: string;
          domain: string;
          from_local: string;
          resend_domain_id: string | null;
          status: 'pending' | 'verified' | 'failed' | 'temporary_failure';
          records: Json;
          last_checked_at: string | null;
          verified_at: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          gym_id: string;
          domain: string;
          from_local?: string;
          resend_domain_id?: string | null;
          status?: 'pending' | 'verified' | 'failed' | 'temporary_failure';
          records?: Json;
          last_checked_at?: string | null;
          verified_at?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<{
          gym_id: string;
          domain: string;
          from_local: string;
          resend_domain_id: string | null;
          status: 'pending' | 'verified' | 'failed' | 'temporary_failure';
          records: Json;
          last_checked_at: string | null;
          verified_at: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        }>;
        Relationships: [];
      };
      demo_marketing_credentials: {
        Row: {
          slug: string;
          gym_name: string;
          owner_email: string;
          owner_password: string;
          member_email: string;
          member_password: string;
          rotated_at: string;
        };
        Insert: {
          slug: string;
          gym_name: string;
          owner_email: string;
          owner_password: string;
          member_email: string;
          member_password: string;
          rotated_at?: string;
        };
        Update: Partial<{
          slug: string;
          gym_name: string;
          owner_email: string;
          owner_password: string;
          member_email: string;
          member_password: string;
          rotated_at: string;
        }>;
        Relationships: [];
      };
    };
    Views: {
      v_member_cohort: {
        Row: {
          gym_id: string;
          profile_id: string;
          joined_at: string;
          is_intro: boolean;
          is_paying: boolean;
          is_active: boolean;
          is_expiring_soon: boolean;
          is_expired: boolean;
          days_until_expiry: number | null;
        };
        Relationships: [];
      };
      pending_members: {
        Row: {
          id: string;
          gym_id: string;
          email: string;
          full_name: string | null;
          date_of_birth: string | null;
          plan_name: string | null;
          plan_start: string | null;
          plan_end: string | null;
          credits_remaining: number | null;
          imported_status: string | null;
          tags: string[];
          unsubscribed: boolean;
          notes: string | null;
          status: 'pending' | 'invited' | 'linked' | 'skipped';
          created_by: string | null;
          created_at: string;
          linked_at: string | null;
          linked_profile_id: string | null;
          linked_membership_plan_id: string | null;
          agreed_plan_id: string | null;
          first_session_id: string | null;
          phone: string | null;
          emergency_contact: string | null;
          next_bill_date: string | null;
          imported_stripe_subscription_id: string | null;
          imported_stripe_customer_id: string | null;
        };
        Insert: {
          id?: string;
          gym_id: string;
          email: string;
          full_name?: string | null;
          date_of_birth?: string | null;
          plan_name?: string | null;
          plan_start?: string | null;
          plan_end?: string | null;
          credits_remaining?: number | null;
          imported_status?: string | null;
          tags?: string[];
          unsubscribed?: boolean;
          notes?: string | null;
          status?: 'pending' | 'invited' | 'linked' | 'skipped';
          created_by?: string | null;
          created_at?: string;
          linked_at?: string | null;
          linked_profile_id?: string | null;
          linked_membership_plan_id?: string | null;
          agreed_plan_id?: string | null;
          first_session_id?: string | null;
          phone?: string | null;
          emergency_contact?: string | null;
          next_bill_date?: string | null;
          imported_stripe_subscription_id?: string | null;
          imported_stripe_customer_id?: string | null;
        };
        Update: Partial<{
          id: string;
          gym_id: string;
          email: string;
          full_name: string | null;
          date_of_birth: string | null;
          plan_name: string | null;
          plan_start: string | null;
          plan_end: string | null;
          credits_remaining: number | null;
          imported_status: string | null;
          tags: string[];
          unsubscribed: boolean;
          notes: string | null;
          status: 'pending' | 'invited' | 'linked' | 'skipped';
          created_by: string | null;
          created_at: string;
          linked_at: string | null;
          linked_profile_id: string | null;
          linked_membership_plan_id: string | null;
          agreed_plan_id: string | null;
          first_session_id: string | null;
          phone: string | null;
          emergency_contact: string | null;
          next_bill_date: string | null;
          imported_stripe_subscription_id: string | null;
          imported_stripe_customer_id: string | null;
        }>;
        Relationships: [];
      };
      store_products: {
        Row: {
          id: string;
          gym_id: string;
          name: string;
          description: string | null;
          kind: StoreProductKind;
          price_cents: number;
          image_url: string | null;
          image_urls: string[];
          track_inventory: boolean;
          stock_quantity: number | null;
          digital_asset_path: string | null;
          active: boolean;
          archived_at: string | null;
          recurring: boolean;
          recurring_interval: string | null;
          stripe_price_id: string | null;
          category: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          name: string;
          description?: string | null;
          kind: StoreProductKind;
          price_cents: number;
          image_url?: string | null;
          image_urls?: string[];
          track_inventory?: boolean;
          stock_quantity?: number | null;
          digital_asset_path?: string | null;
          active?: boolean;
          archived_at?: string | null;
          recurring?: boolean;
          recurring_interval?: string | null;
          stripe_price_id?: string | null;
          category?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<{
          name: string;
          description: string | null;
          kind: StoreProductKind;
          price_cents: number;
          image_url: string | null;
          image_urls: string[];
          track_inventory: boolean;
          stock_quantity: number | null;
          digital_asset_path: string | null;
          active: boolean;
          archived_at: string | null;
          recurring: boolean;
          recurring_interval: string | null;
          stripe_price_id: string | null;
          category: string | null;
          updated_at: string;
        }>;
        Relationships: [];
      };
      store_orders: {
        Row: {
          id: string;
          gym_id: string;
          profile_id: string;
          status: StoreOrderStatus;
          subtotal_cents: number;
          shipping_cents: number;
          total_cents: number;
          currency: string;
          has_physical: boolean;
          shipping_name: string | null;
          shipping_address: Json | null;
          tracking_note: string | null;
          subscription_id: string | null;
          stripe_checkout_session_id: string | null;
          stripe_payment_intent_id: string | null;
          stripe_invoice_id: string | null;
          paid_at: string | null;
          fulfilled_at: string | null;
          fulfilled_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          profile_id: string;
          status?: StoreOrderStatus;
          subtotal_cents?: number;
          shipping_cents?: number;
          total_cents?: number;
          currency: string;
          has_physical?: boolean;
          shipping_name?: string | null;
          shipping_address?: Json | null;
          tracking_note?: string | null;
          subscription_id?: string | null;
          stripe_checkout_session_id?: string | null;
          stripe_payment_intent_id?: string | null;
          stripe_invoice_id?: string | null;
          paid_at?: string | null;
          fulfilled_at?: string | null;
          fulfilled_by?: string | null;
          created_at?: string;
        };
        Update: Partial<{
          status: StoreOrderStatus;
          tracking_note: string | null;
          stripe_checkout_session_id: string | null;
          stripe_payment_intent_id: string | null;
          stripe_invoice_id: string | null;
          paid_at: string | null;
          fulfilled_at: string | null;
          fulfilled_by: string | null;
        }>;
        Relationships: [];
      };
      store_order_items: {
        Row: {
          id: string;
          order_id: string;
          gym_id: string;
          product_id: string | null;
          variant_id: string | null;
          variant_snapshot: string | null;
          name_snapshot: string;
          kind_snapshot: StoreProductKind;
          unit_price_cents: number;
          quantity: number;
          line_total_cents: number;
        };
        Insert: {
          id?: string;
          order_id: string;
          gym_id: string;
          product_id?: string | null;
          variant_id?: string | null;
          variant_snapshot?: string | null;
          name_snapshot: string;
          kind_snapshot: StoreProductKind;
          unit_price_cents: number;
          quantity: number;
          line_total_cents: number;
        };
        Update: Partial<{
          product_id: string | null;
          name_snapshot: string;
          quantity: number;
          line_total_cents: number;
        }>;
        Relationships: [];
      };
      store_product_variants: {
        Row: {
          id: string;
          product_id: string;
          gym_id: string;
          name: string;
          sort_order: number;
          stock_quantity: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          product_id: string;
          gym_id: string;
          name: string;
          sort_order?: number;
          stock_quantity?: number | null;
          created_at?: string;
        };
        Update: Partial<{
          name: string;
          sort_order: number;
          stock_quantity: number | null;
        }>;
        Relationships: [];
      };
      store_digital_deliveries: {
        Row: {
          id: string;
          order_item_id: string;
          gym_id: string;
          product_id: string | null;
          profile_id: string;
          name_snapshot: string;
          asset_path: string;
          created_at: string;
          last_downloaded_at: string | null;
          // Set when the order was refunded; the select policy hides it.
          revoked_at: string | null;
        };
        Insert: {
          id?: string;
          order_item_id: string;
          gym_id: string;
          product_id?: string | null;
          profile_id: string;
          name_snapshot: string;
          asset_path: string;
          created_at?: string;
          last_downloaded_at?: string | null;
          revoked_at?: string | null;
        };
        Update: Partial<{
          last_downloaded_at: string | null;
          revoked_at: string | null;
        }>;
        Relationships: [];
      };
      store_subscriptions: {
        Row: {
          id: string;
          gym_id: string;
          profile_id: string;
          product_id: string | null;
          name_snapshot: string;
          kind_snapshot: StoreProductKind;
          unit_price_cents: number;
          currency: string;
          interval: string;
          digital_asset_path: string | null;
          shipping_name: string | null;
          shipping_address: Json | null;
          status: StoreSubscriptionStatus;
          cancel_at_period_end: boolean;
          current_period_end: string | null;
          stripe_subscription_id: string | null;
          stripe_customer_id: string | null;
          created_at: string;
          updated_at: string;
          cancelled_at: string | null;
        };
        Insert: {
          id?: string;
          gym_id: string;
          profile_id: string;
          product_id?: string | null;
          name_snapshot: string;
          kind_snapshot: StoreProductKind;
          unit_price_cents: number;
          currency: string;
          interval: string;
          digital_asset_path?: string | null;
          shipping_name?: string | null;
          shipping_address?: Json | null;
          status?: StoreSubscriptionStatus;
          cancel_at_period_end?: boolean;
          current_period_end?: string | null;
          stripe_subscription_id?: string | null;
          stripe_customer_id?: string | null;
          created_at?: string;
          updated_at?: string;
          cancelled_at?: string | null;
        };
        Update: Partial<{
          status: StoreSubscriptionStatus;
          cancel_at_period_end: boolean;
          current_period_end: string | null;
          shipping_name: string | null;
          shipping_address: Json | null;
          updated_at: string;
          cancelled_at: string | null;
        }>;
        Relationships: [];
      };
    };
    Functions: {
      accept_invite: {
        Args: { invite_code: string };
        Returns: { gym_id: string; role: GymRole }[];
      };
      timeline_feed: {
        Args: { p_gym_id: string; p_before?: string | null; p_limit?: number };
        Returns: {
          item_id: string;
          kind: string;
          occurred_at: string;
          subject: string;
          detail: Json;
        }[];
      };
      set_money_job: {
        Args: { p_gym_id: string; p_enabled: boolean };
        Returns: null;
      };
      set_retention_job: {
        Args: { p_gym_id: string; p_enabled: boolean };
        Returns: null;
      };
      set_cover_job: {
        Args: { p_gym_id: string; p_enabled: boolean };
        Returns: null;
      };
      set_first_week_job: {
        Args: { p_gym_id: string; p_enabled: boolean };
        Returns: null;
      };
      set_credits_low_job: {
        Args: { p_gym_id: string; p_enabled: boolean };
        Returns: null;
      };
      set_plan_upgrade_job: {
        Args: { p_gym_id: string; p_enabled: boolean };
        Returns: null;
      };
      set_class_return_job: {
        Args: { p_gym_id: string; p_enabled: boolean };
        Returns: null;
      };
      set_agent_job_level: {
        Args: {
          p_gym_id: string;
          p_action_kind: string;
          p_level: 'autonomous' | 'approval' | 'reserved';
        };
        Returns: null;
      };
      decide_agent_action: {
        Args: {
          p_action_id: string;
          p_decision: 'approve' | 'reject';
          p_always_allow?: boolean;
        };
        Returns: null;
      };
      request_payment_chase: {
        Args: {
          p_gym_id: string;
          p_subscription_id: string;
        };
        Returns: string;
      };
      payment_chase_preview: {
        Args: {
          p_gym_id: string;
          p_subscription_id: string;
        };
        Returns: {
          subject: string;
          body: string;
        }[];
      };
      set_membership_change_policies: {
        Args: {
          p_gym_id: string;
          p_upgrade: 'self_serve' | 'request';
          p_downgrade: 'self_serve' | 'request';
          p_cancel: 'self_serve' | 'request';
        };
        Returns: null;
      };
      staff_membership_change_requests: {
        Args: { p_gym_id: string };
        Returns: {
          id: string;
          profile_id: string;
          plan_subscription_id: string;
          kind: 'cancel' | 'switch_plan';
          member_note: string | null;
          created_at: string;
          member_name: string | null;
          current_plan_name: string | null;
          target_plan_name: string | null;
        }[];
      };
      submit_parq_response: {
        Args: {
          p_gym_id: string;
          p_questionnaire_id: string;
          p_answers: Json;
          p_subject_profile_id?: string;
        };
        Returns: string;
      };
      create_dependent: {
        Args: {
          p_gym_id: string;
          p_full_name: string;
          p_dob: string;
          p_policy_version: string;
        };
        Returns: string;
      };
      is_guardian_of: {
        Args: { p_dependent_profile_id: string };
        Returns: boolean;
      };
      parent_book_dependent: {
        Args: { p_session_id: string; p_dependent_id: string };
        Returns: string;
      };
      parent_cancel_dependent_booking: {
        Args: { p_booking_id: string };
        Returns: null;
      };
      remove_dependent: {
        Args: { p_dependent_id: string };
        Returns: null;
      };
      current_parq_state: {
        Args: { p_gym_id: string; p_profile_id: string };
        Returns: {
          active_questionnaire_id: string | null;
          last_response_id: string | null;
          last_completed_at: string | null;
          last_had_flag: boolean | null;
          needs_parq: boolean;
        }[];
      };
      publish_waiver: {
        Args: {
          p_gym_id: string;
          p_title: string;
          p_file_path: string;
          p_file_url: string;
        };
        Returns: string;
      };
      sign_waiver: {
        Args: {
          p_gym_id: string;
          p_waiver_id: string;
          p_signature: Json;
          p_subject_profile_id?: string;
        };
        Returns: string;
      };
      current_waiver_state: {
        Args: { p_gym_id: string; p_profile_id: string };
        Returns: {
          active_waiver_id: string | null;
          last_signature_id: string | null;
          last_signed_at: string | null;
          needs_waiver: boolean;
        }[];
      };
      log_injury: {
        Args: {
          p_gym_id: string;
          p_body_region: string;
          p_side: string;
          p_description: string | null;
          p_pain_level: number;
          p_movements_hurt: string[];
          p_movements_ok: string[];
          p_started_on: string;
        };
        Returns: string;
      };
      log_injury_update: {
        Args: {
          p_injury_id: string;
          p_pain_level: number;
          p_feeling: string | null;
          p_status: string;
          p_note: string | null;
        };
        Returns: string;
      };
      acknowledge_staff_alert: {
        Args: { p_alert_id: string };
        Returns: null;
      };
      announcement_read_stats: {
        Args: { p_announcement_id: string };
        Returns: { read_count: number; member_count: number }[];
      };
      my_gyms: {
        Args: Record<string, never>;
        Returns: {
          gym_id: string;
          gym_name: string;
          role: GymRole;
          joined_at: string;
          left_at: string | null;
        }[];
      };
      export_my_account_data: {
        Args: Record<string, never>;
        Returns: Json;
      };
      record_consent: {
        Args: {
          p_gym_id: string;
          p_policy_version: string;
          p_lawful_basis?: string;
          p_guardian_name?: string;
          p_guardian_contact?: string;
        };
        Returns: null;
      };
      erase_member_health_data: {
        Args: { p_gym_id: string; p_profile: string };
        Returns: null;
      };
      purge_expired_waiver_signatures: {
        Args: Record<string, never>;
        Returns: number;
      };
      gym_member_injuries: {
        Args: { p_gym_id: string; p_profile_id: string };
        Returns: {
          id: string;
          body_region: string;
          side: string;
          description: string | null;
          pain_level: number;
          movements_hurt: string[];
          movements_ok: string[];
          started_on: string | null;
          status: string;
          updated_at: string;
        }[];
      };
      gym_injury_updates: {
        Args: { p_gym_id: string; p_profile_id: string };
        Returns: {
          injury_id: string;
          pain_level: number;
          feeling: string;
          status: string;
          note: string | null;
          created_at: string;
        }[];
      };
      gym_open_injuries: {
        Args: { p_gym_id: string; p_surface?: string };
        Returns: {
          id: string;
          profile_id: string;
          full_name: string | null;
          body_region: string;
          side: string;
          pain_level: number;
          status: string;
          movements_hurt: string[];
          updated_at: string;
        }[];
      };
      log_health_data_access: {
        Args: { p_gym_id: string; p_subject: string; p_surface: string };
        Returns: null;
      };
      get_gym_setup_progress: {
        Args: { p_gym_id: string };
        Returns: {
          step_key: string;
          done: boolean;
          complete: number;
          target: number;
        }[];
      };
      extend_recurrence: {
        Args: { rec_id: string; until_date: string };
        Returns: null;
      };
      extend_gym_recurrences: {
        Args: { p_gym_id: string; p_until: string };
        Returns: null;
      };
      book_class: {
        Args: {
          session_id: string;
          p_entitlement_kind?: 'comp_grant' | 'plan_subscription' | null;
          p_entitlement_id?: string | null;
        };
        Returns: string | null;
      };
      staff_book_member: {
        Args: {
          p_session_id: string;
          p_member_profile_id: string;
          p_entitlement_kind?: 'comp_grant' | 'plan_subscription' | null;
          p_entitlement_id?: string | null;
          p_no_charge?: boolean;
          p_over_capacity?: boolean;
        };
        Returns: string;
      };
      swap_booking_subscription: {
        Args: {
          p_booking_id: string;
          p_entitlement_kind?: 'comp_grant' | 'plan_subscription' | null;
          p_entitlement_id?: string | null;
          p_no_charge?: boolean;
        };
        Returns: null;
      };
      record_lead: {
        Args: {
          p_gym_id: string;
          p_full_name: string;
          p_email?: string | null;
          p_phone?: string | null;
          p_source_id?: string | null;
          p_notes?: string | null;
        };
        Returns: string;
      };
      my_training_summary: {
        Args: Record<string, never>;
        Returns: {
          workouts: number;
          results: number;
          races: number;
          gyms: number;
          first_at: string | null;
          last_at: string | null;
        };
      };
      export_my_training_history: {
        Args: Record<string, never>;
        Returns: unknown;
      };
      is_athlete_active: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      start_athlete_subscription: {
        Args: Record<string, never>;
        Returns: null;
      };
      cancel_athlete_subscription: {
        Args: Record<string, never>;
        Returns: null;
      };
      set_lead_status: {
        Args: {
          p_lead_id: string;
          p_status: LeadStatus;
          p_converted_profile_id?: string | null;
        };
        Returns: null;
      };
      assign_lead: {
        Args: { p_lead_id: string };
        Returns: string | null;
      };
      set_lead_assignee: {
        Args: { p_lead_id: string; p_coach_id: string | null };
        Returns: null;
      };
      nudge_lead: {
        Args: { p_lead_id: string };
        Returns: null;
      };
      mark_lead_notification_read: {
        Args: { p_id: string };
        Returns: null;
      };
      requeue_lead_notification: {
        Args: { p_id: string };
        Returns: null;
      };
      count_unread_lead_notifications: {
        Args: { p_gym_id: string };
        Returns: number;
      };
      set_lead_assignment_rule: {
        Args: {
          p_gym_id: string;
          p_strategy: 'round_robin' | 'single_default' | 'manual';
          p_default_coach_id?: string | null;
        };
        Returns: null;
      };
      set_gym_lead_sms: {
        Args: { p_gym_id: string; p_enabled: boolean };
        Returns: null;
      };
      set_gym_lead_retention: {
        Args: { p_gym_id: string; p_days: number };
        Returns: null;
      };
      set_gym_agent_enabled: {
        Args: { p_gym_id: string; p_enabled: boolean };
        Returns: null;
      };
      set_gym_agent_context: {
        Args: { p_gym_id: string; p_context: string | null };
        Returns: null;
      };
      set_gym_agent_voice: {
        Args: { p_gym_id: string; p_enabled: boolean };
        Returns: null;
      };
      set_gym_agent_voice_selection: {
        Args: {
          p_gym_id: string;
          p_provider: string | null;
          p_voice_id: string | null;
          p_region: string | null;
        };
        Returns: null;
      };
      set_gym_call_recording: {
        Args: { p_gym_id: string; p_enabled: boolean; p_retention_days: number };
        Returns: null;
      };
      set_gym_agent_limits: {
        Args: {
          p_gym_id: string;
          p_daily_message_cap: number;
          p_conversation_retention_days: number;
        };
        Returns: null;
      };
      set_agent_interview_status: {
        Args: { p_id: string; p_status: string };
        Returns: null;
      };
      agent_outcomes: {
        Args: { p_gym_id: string };
        Returns: {
          leads_30d: number;
          committed: number;
          converted_30d: number;
          attributed_monthly_cents: number;
          currency: string;
        }[];
      };
      record_agent_corrections: {
        Args: { p_gym_id: string; p_rows: Json };
        Returns: null;
      };
      set_agent_correction_active: {
        Args: { p_id: string; p_active: boolean };
        Returns: null;
      };
      log_recording_access: {
        Args: { p_gym_id: string; p_recording: string; p_surface: string };
        Returns: null;
      };
      my_agreed_plan: {
        Args: { p_gym_id: string };
        Returns: { plan_id: string; plan_name: string }[];
      };
      clear_lead_follow_up: {
        Args: { p_lead_id: string };
        Returns: null;
      };
      my_staged_first_class: {
        Args: { p_gym_id: string };
        Returns: { session_id: string; session_name: string; starts_at: string }[];
      };
      clear_my_first_class: {
        Args: { p_gym_id: string };
        Returns: null;
      };
      clear_my_agreed_plan: {
        Args: { p_gym_id: string };
        Returns: null;
      };
      is_booking_eligible: {
        Args: {
          p_profile_id: string;
          p_gym_id: string;
          p_class_session_id: string;
        };
        Returns: boolean;
      };
      list_booking_entitlements: {
        Args: {
          p_class_session_id: string;
          p_target_profile_id?: string | null;
        };
        Returns: {
          kind: 'comp_grant' | 'plan_subscription';
          id: string;
          is_default: boolean;
          label: string;
        }[];
      };
      same_gym_as_caller: {
        Args: { target_profile: string };
        Returns: boolean;
      };
      check_in_member: {
        Args: { p_booking_id: string };
        Returns: null;
      };
      mark_no_show: {
        Args: { p_booking_id: string };
        Returns: null;
      };
      compute_insight_summary: {
        Args: { p_gym_id: string; p_period_start: string; p_period_end: string };
        Returns: {
          intros_new: number;
          intros_target: number;
          conversions: number;
          conversions_target: number;
          conversions_target_unit: 'count' | 'rate';
          retention_now: number;
          retention_base: number;
          retention_target: number;
          retention_target_unit: 'count' | 'rate';
          expiring_soon: number;
          expired: number;
          paying_now: number;
          billing_live: boolean;
          lead_conversions: number;
        }[];
      };
      compute_finance_summary: {
        Args: { p_gym_id: string; p_month_start: string };
        Returns: {
          currency: string;
          confirmed_cents: number;
          confirmed_count: number;
          pending_cents: number;
          pending_count: number;
          at_risk_cents: number;
          at_risk_count: number;
          forward_mrr_cents: number;
          forward_count: number;
        }[];
      };
      gym_overdue_memberships: {
        Args: { p_gym_id: string };
        Returns: {
          subscription_id: string;
          profile_id: string;
          full_name: string | null;
          plan_name: string;
          amount_cents: number;
          currency: string;
          past_due_since: string;
          payment_failure_count: number;
          next_payment_attempt: string | null;
          last_payment_error: string | null;
          notice_status: string | null;
        }[];
      };
      compute_revenue_summary: {
        Args: { p_gym_id: string; p_period_start: string; p_period_end: string };
        Returns: {
          currency: string;
          gross_cents: number;
          charge_count: number;
        }[];
      };
      compute_coach_earnings: {
        Args: {
          p_gym_id: string;
          p_coach_id: string;
          p_period_start: string;
          p_period_end: string;
        };
        Returns: {
          class_type_id: string;
          class_type_name: string;
          class_type_color: string;
          class_count: number;
          rate_cents: number;
          earnings_cents: number;
          currency: string;
        }[];
      };
      set_coach_credit_policy: {
        Args: { p_gym_id: string; p_policy: 'all_scheduled' | 'only_checked_in' };
        Returns: null;
      };
      set_dm_scope: {
        Args: { p_gym_id: string; p_scope: 'full_gym' | 'member_coach_only' };
        Returns: null;
      };
      mark_dm_thread_read: {
        Args: { p_peer_id: string };
        Returns: null;
      };
      dm_inbox: {
        Args: Record<string, never>;
        Returns: {
          peer_profile_id: string;
          peer_full_name: string;
          peer_role: GymRole | null;
          last_message_id: string;
          last_message_body: string;
          last_message_at: string;
          last_message_from_me: boolean;
          unread_count: number;
        }[];
      };
      inbox_unread_summary: {
        Args: Record<string, never>;
        Returns: {
          dm_unread: number;
          announcement_unread: number;
          class_broadcast_unread: number;
          class_change_unread: number;
          payment_unread: number;
        }[];
      };
      can_dm: {
        Args: { p_gym_id: string; p_sender: string; p_recipient: string };
        Returns: boolean;
      };
      gym_by_slug: {
        Args: { p_slug: string };
        Returns: {
          id: string;
          name: string;
          slug: string;
          logo_url: string | null;
          primary_color: string;
          secondary_color: string;
          text_color: string;
          public_signup_enabled: boolean;
          logo_url_dark: string | null;
          primary_color_dark: string | null;
          secondary_color_dark: string | null;
          text_color_dark: string | null;
          public_lead_capture_enabled: boolean;
        }[];
      };
      gym_website_by_slug: {
        Args: { p_slug: string };
        Returns: {
          gym_id: string;
          gym_name: string;
          gym_logo_url: string | null;
          gym_primary_color: string;
          gym_currency: string;
          theme: string;
          design: Json;
        }[];
      };
      gym_public_schedule: {
        Args: { p_slug: string };
        Returns: {
          session_id: string;
          starts_at: string;
          duration_minutes: number;
          class_type_name: string | null;
          class_type_color: string | null;
          coach_name: string | null;
        }[];
      };
      gym_public_plans: {
        Args: { p_slug: string };
        Returns: {
          plan_id: string;
          name: string;
          kind: string;
          credit_count: number | null;
          monthly_price_cents: number | null;
        }[];
      };
      gym_public_team: {
        Args: { p_slug: string };
        Returns: {
          profile_id: string;
          full_name: string | null;
          avatar_url: string | null;
        }[];
      };
      gym_public_ai_phone: {
        Args: { p_slug: string };
        Returns: {
          phone_number: string;
        }[];
      };
      save_gym_website: {
        Args: {
          p_gym_id: string;
          p_design: Json;
          p_theme: string;
          p_expected_updated_at?: string | null;
        };
        Returns: string;
      };
      publish_gym_website: {
        Args: { p_gym_id: string };
        Returns: string;
      };
      unpublish_gym_website: {
        Args: { p_gym_id: string };
        Returns: string;
      };
      demo_marketing_credentials: {
        Args: Record<string, never>;
        Returns: {
          slug: string;
          gym_name: string;
          owner_email: string;
          owner_password: string;
          member_email: string;
          member_password: string;
          rotated_at: string;
        }[];
      };
      gym_slug_for_domain: {
        Args: { p_host: string };
        Returns: string | null;
      };
      gym_website_canonical_domain: {
        Args: { p_slug: string };
        Returns: string | null;
      };
      invite_code_gym: {
        Args: { p_code: string };
        Returns: {
          gym_id: string;
          name: string;
          logo_url: string | null;
          primary_color: string;
          secondary_color: string;
          text_color: string;
          logo_url_dark: string | null;
          primary_color_dark: string | null;
          role: GymRole;
        }[];
      };
      set_gym_public_lead_capture: {
        Args: { p_gym_id: string; p_enabled: boolean };
        Returns: null;
      };
      capture_public_lead: {
        Args: {
          p_slug: string;
          p_full_name: string;
          p_email: string;
          p_phone?: string | null;
          p_message?: string | null;
          p_marketing_consent?: boolean;
        };
        Returns: null;
      };
      create_gym: {
        Args: { p_name: string; p_slug: string };
        Returns: string;
      };
      join_gym_by_slug: {
        Args: { p_slug: string };
        Returns: string;
      };
      set_gym_name: {
        Args: { p_gym_id: string; p_name: string };
        Returns: null;
      };
      set_gym_slug: {
        Args: { p_gym_id: string; p_slug: string };
        Returns: null;
      };
      set_gym_public_signup: {
        Args: { p_gym_id: string; p_enabled: boolean };
        Returns: null;
      };
      dismiss_gym_onboarding: {
        Args: { p_gym_id: string };
        Returns: void;
      };
      set_gym_operating_defaults: {
        Args: {
          p_gym_id: string;
          p_week_starts_on: 'mon' | 'sun';
          p_timezone: string;
          p_default_class_capacity: number;
          p_default_class_minutes: number;
          p_expiring_within_days: number;
          p_parq_expiry_days: number;
          p_health_retention_months: number;
          p_lead_conversion_window_days: number;
          p_subscription_resolution:
            | 'credits_first'
            | 'newest_first'
            | 'highest_priority';
          p_booking_window_hours_ahead?: number | null;
          p_booking_cutoff_minutes_before?: number;
          p_cancel_cutoff_minutes_before?: number;
          p_cancel_cutoff_mode?: 'relative' | 'day_before';
          p_cancel_cutoff_time?: string | null;
          p_cancel_cutoff_days_before?: number;
          p_cover_warning_hours?: number;
        };
        Returns: null;
      };
      set_leaderboard_config: {
        Args: {
          p_gym_id: string;
          p_class_enabled: boolean;
          p_strength_enabled: boolean;
        };
        Returns: null;
      };
      set_appear_in_leaderboards: {
        Args: { p_gym_id: string; p_value: boolean };
        Returns: null;
      };
      class_leaderboard: {
        Args: { p_programming_id: string; p_section_index: number };
        Returns: {
          profile_id: string;
          display_name: string;
          score: number;
          total_time_seconds: number | null;
          total_rounds: number | null;
          total_extra_reps: number | null;
          did_not_finish: boolean | null;
          heaviest_weight: number | null;
          weight_unit: string | null;
          total_distance_m: number | null;
          total_calories: number | null;
          section_format: string;
          performed_at: string;
          rank: number;
        }[];
      };
      strength_leaderboard: {
        Args: {
          p_gym_id: string;
          p_movement_key: string;
          p_track_key: string;
          p_metric: 'weight' | 'time' | 'reps' | 'distance' | 'calories';
          p_better: 'higher' | 'lower';
        };
        Returns: {
          profile_id: string;
          display_name: string;
          value_numeric: number | null;
          value_seconds: number | null;
          performed_at: string;
          source: 'direct' | 'tag';
          rank: number;
        }[];
      };
      is_revenue_event: {
        Args: { p_provider: string; p_kind: string };
        Returns: boolean;
      };
      effective_can: {
        Args: { p_gym_id: string; p_capability: string };
        Returns: boolean;
      };
      effective_can_for_role: {
        Args: { p_gym_id: string; p_role: GymRole; p_capability: string };
        Returns: boolean;
      };
      default_capability: {
        Args: { p_role: GymRole; p_capability: string };
        Returns: boolean;
      };
      count_members_as_of: {
        Args: { p_gym_id: string; p_as_of: string };
        Returns: number;
      };
      count_open_staff_alerts: {
        Args: { p_gym_id: string };
        Returns: number;
      };
      count_attendance_attendees: {
        Args: { p_gym_id: string; p_period_start: string; p_period_end: string };
        Returns: number;
      };
      apply_tag_rules: {
        Args: { p_gym_id: string };
        Returns: number;
      };
      request_cover: {
        Args: { p_session_ids: string[]; p_notes: string | null };
        Returns: string;
      };
      request_cover_range: {
        Args: {
          p_gym_id: string;
          p_start: string;
          p_end: string;
          p_exclude_session_ids: string[] | null;
          p_notes: string | null;
        };
        Returns: string;
      };
      claim_cover: {
        Args: { p_session_offer_id: string };
        Returns: null;
      };
      cancel_cover_request: {
        Args: { p_request_id: string };
        Returns: null;
      };
      count_unread_cover_notifications: {
        Args: { p_gym_id: string };
        Returns: number;
      };
      mark_cover_notifications_read: {
        Args: { p_gym_id: string };
        Returns: null;
      };
      class_session_training_partners: {
        Args: { p_session_ids: string[] };
        Returns: {
          class_session_id: string;
          profile_id: string;
          full_name: string;
          avatar_url: string | null;
        }[];
      };
      close_gym_dates: {
        Args: {
          p_gym_id: string;
          p_start: string;
          p_end: string;
          p_reason: string | null;
          p_exclude_session_ids: string[] | null;
        };
        Returns: { closure_id: string; cancelled: number; notified: number };
      };
      remove_member_booking: {
        Args: {
          p_gym_id: string;
          p_session_id: string;
          p_profile_id: string;
          p_refund?: boolean;
        };
        Returns: {
          removed: boolean;
          refunded: boolean;
          promoted_profile_id: string | null;
          promoted_name: string | null;
        };
      };
      staff_join_waitlist: {
        Args: { p_gym_id: string; p_session_id: string; p_profile_id: string };
        Returns: number;
      };
      staff_leave_waitlist: {
        Args: { p_gym_id: string; p_session_id: string; p_profile_id: string };
        Returns: boolean;
      };
      assign_member_plan: {
        Args: {
          p_gym_id: string;
          p_profile_id: string;
          p_plan_id: string;
          p_until?: string | null;
          p_mode?: string;
        };
        Returns: {
          subscription_id: string;
          switched: boolean;
          plan_name: string;
          plan_kind: string;
          price_cents: number | null;
          credit_balance: number | null;
          ends_at: string | null;
          runs_to: string | null;
        };
      };
      earmark_pending_member_plan: {
        Args: {
          p_gym_id: string;
          p_pending_id: string;
          p_plan_id: string;
          p_until?: string | null;
        };
        Returns: {
          pending_id: string;
          email: string;
          plan_name: string;
          plan_kind: string;
          price_cents: number | null;
          runs_to: string | null;
        };
      };
      grant_member_comp: {
        Args: {
          p_gym_id: string;
          p_profile_id: string;
          p_days?: number;
          p_credits?: number | null;
          p_reason?: string | null;
        };
        Returns: {
          grant_id: string;
          days: number;
          credits: number | null;
          ends_at: string;
        };
      };
      preview_closure_reopen: {
        Args: { p_closure_id: string };
        Returns: {
          recurrence_id: string;
          starts_at: string;
          local_date: string;
          class_type_name: string;
          duration_minutes: number;
          capacity: number;
        }[];
      };
      reopen_closure: {
        Args: {
          p_closure_id: string;
          p_exclude: { recurrence_id: string; starts_at: string }[] | null;
        };
        Returns: { restored: number; lifted: boolean; notified: number };
      };
      bulk_edit_sessions: {
        Args: {
          p_gym_id: string;
          p_start: string;
          p_end: string;
          p_session_ids: string[] | null;
          p_capacity: number | null;
          p_duration_minutes: number | null;
          p_shift_minutes: number | null;
        };
        Returns: {
          updated: number;
          skipped_overbooked: number;
          skipped_past: number;
          skipped_conflict: number;
          notified: number;
          recurrences_updated: number;
          recurrences_split: number;
          recurrences_unchanged: number;
        };
      };
      gym_member_contacts: {
        Args: { p_gym_id: string };
        Returns: { profile_id: string; email: string | null; phone: string | null }[];
      };
      gym_member_contact: {
        Args: { p_gym_id: string; p_profile_id: string };
        Returns: { email: string | null; phone: string | null }[];
      };
      mark_payment_notifications_read: {
        Args: { p_gym_id: string };
        Returns: null;
      };
      mark_class_change_notifications_read: {
        Args: { p_gym_id: string };
        Returns: null;
      };
      complete_task: {
        Args: { p_task_id: string };
        Returns: null;
      };
      reopen_task: {
        Args: { p_task_id: string };
        Returns: null;
      };
      create_invite: {
        Args: { p_gym_id: string; p_role: GymRole; p_expires_at: string | null };
        Returns: string;
      };
      set_member_self_checkout: {
        Args: { p_gym_id: string; p_enabled: boolean };
        Returns: undefined;
      };
      set_require_membership_to_book: {
        Args: { p_gym_id: string; p_enabled: boolean };
        Returns: undefined;
      };
      set_allow_minors: {
        Args: { p_gym_id: string; p_enabled: boolean };
        Returns: undefined;
      };
      set_gym_weight_unit: {
        Args: { p_gym_id: string; p_unit: string };
        Returns: null;
      };
      set_gym_discipline: {
        Args: { p_gym_id: string; p_discipline: string };
        Returns: undefined;
      };
      set_gym_currency: {
        Args: { p_gym_id: string; p_currency: string };
        Returns: undefined;
      };
      set_member_booking_requirement: {
        Args: { p_gym_id: string; p_profile_id: string; p_value: boolean | null };
        Returns: undefined;
      };
      update_my_emergency_contact: {
        Args: { p_gym_id: string; p_contact: string | null };
        Returns: undefined;
      };
      class_type_has_dependents: {
        Args: { p_id: string };
        Returns: boolean;
      };
      plan_has_dependents: {
        Args: { p_id: string };
        Returns: boolean;
      };
      member_has_dependents: {
        Args: { p_gym_id: string; p_profile_id: string };
        Returns: boolean;
      };
      is_terminal_subscription_status: {
        Args: { p_status: PlanSubState };
        Returns: boolean;
      };
      archive_class_type: {
        Args: { p_id: string };
        Returns: null;
      };
      restore_class_type: {
        Args: { p_id: string };
        Returns: null;
      };
      delete_class_type: {
        Args: { p_id: string };
        Returns: null;
      };
      archive_plan: {
        Args: { p_plan_id: string };
        Returns: null;
      };
      restore_plan: {
        Args: { p_plan_id: string };
        Returns: null;
      };
      delete_plan: {
        Args: { p_plan_id: string };
        Returns: null;
      };
      leave_gym: {
        Args: { p_gym_id: string; p_profile_id: string };
        Returns: null;
      };
      reschedule_session: {
        Args: {
          p_session_id: string;
          p_starts_at: string;
          p_duration?: number | null;
        };
        Returns: null;
      };
      set_session_coach: {
        Args: { p_session_id: string; p_coach_id: string };
        Returns: null;
      };
      comms_stop_campaign: {
        Args: { p_campaign_id: string };
        Returns: number;
      };
      set_member_role: {
        Args: {
          p_gym_id: string;
          p_profile_id: string;
          p_role: 'owner' | 'admin' | 'coach' | 'staff' | 'member';
        };
        Returns: null;
      };
      rejoin_gym: {
        Args: { p_gym_id: string; p_profile_id: string };
        Returns: null;
      };
      set_avatar_url: {
        Args: { p_url: string };
        Returns: null;
      };
      copy_week_forward: {
        Args: { p_gym_id: string; p_from: string };
        Returns: number;
      };
      cancel_session: {
        Args: { p_session_id: string };
        Returns: number;
      };
      cancel_recurrence_from: {
        Args: { p_session_id: string };
        Returns: number;
      };
      cancel_recurrence: {
        Args: { p_recurrence_id: string };
        Returns: number;
      };
      join_waitlist: {
        Args: { p_session_id: string };
        Returns: number;
      };
      leave_waitlist: {
        Args: { p_session_id: string };
        Returns: null;
      };
      my_waitlist_rank: {
        Args: { p_session_id: string };
        Returns: number | null;
      };
      waitlist_for_session: {
        Args: { p_session_id: string };
        Returns: { rank: number; profile_id: string; joined_at: string }[];
      };
      comms_audience_count: {
        Args: { p_gym_id: string; p_definition: Json; p_topic_id?: string | null };
        Returns: number;
      };
      list_my_email_preferences: {
        Args: { p_gym_id: string };
        Returns: {
          topic_id: string;
          label: string;
          description: string | null;
          subscribed: boolean;
          blanket_unsub: boolean;
        }[];
      };
      set_my_email_topic_subscription: {
        Args: {
          p_gym_id: string;
          p_topic_id: string;
          p_subscribed: boolean;
        };
        Returns: null;
      };
      set_my_email_blanket_unsub: {
        Args: { p_gym_id: string; p_unsubscribed: boolean };
        Returns: null;
      };
      comms_audience_sample: {
        Args: { p_gym_id: string; p_definition: Json; p_limit?: number };
        Returns: { profile_id: string; full_name: string | null; email: string }[];
      };
      comms_variant_stats: {
        Args: { p_campaign_id: string };
        Returns: {
          variant: number;
          subject: string | null;
          recipients: number;
          delivered: number;
          opened: number;
        }[];
      };
      comms_schedule_campaign: {
        Args: {
          p_campaign_id: string;
          p_send_at: string;
          p_html: string;
          p_text: string;
        };
        Returns: null;
      };
      comms_unschedule_campaign: {
        Args: { p_campaign_id: string };
        Returns: null;
      };
      comms_send_campaign: {
        Args: { p_campaign_id: string; p_html: string; p_text: string };
        Returns: number;
      };
      comms_finalize_simulation: {
        Args: { p_campaign_id: string };
        Returns: number;
      };
      send_automation_test: {
        Args: { p_automation_id: string };
        Returns: null;
      };
      automation_unsubscribe: {
        Args: { p_run_id: string };
        Returns: null;
      };
      lead_withdraw_marketing_consent: {
        Args: { p_run_id: string };
        Returns: null;
      };
      import_pending_members: {
        Args: { p_gym_id: string; p_rows: Json };
        Returns: { inserted: number; updated: number; skipped: number }[];
      };
      record_import_corrections: {
        Args: { p_gym_id: string; p_rows: Json };
        Returns: number;
      };
      import_member_workouts: {
        Args: { p_gym_id: string; p_rows: Json };
        Returns: {
          inserted_workouts: number;
          inserted_results: number;
          skipped_no_member: number;
          skipped_no_movement: number;
          staged: number;
        }[];
      };
      import_member_results: {
        Args: { p_gym_id: string; p_rows: Json };
        Returns: {
          inserted_workouts: number;
          inserted_sections: number;
          skipped_no_member: number;
          skipped_duplicate: number;
          staged: number;
        }[];
      };
      import_member_hyrox_results: {
        Args: { p_gym_id: string; p_rows: Json };
        Returns: {
          inserted_workouts: number;
          inserted_results: number;
          skipped_no_member: number;
          skipped_duplicate: number;
          staged: number;
        }[];
      };
      pending_members_stats: {
        Args: { p_gym_id: string };
        Returns: {
          pending: number;
          invited: number;
          linked: number;
          skipped: number;
          total: number;
        }[];
      };
      // Which screens get opened (0233). No profile_id anywhere in this
      // family — it is a measure, not an audit trail.
      record_route_open: {
        Args: { p_gym_id: string; p_route: string };
        Returns: void;
      };
      gym_route_usage: {
        Args: { p_gym_id: string; p_days?: number };
        Returns: { route: string; opens: number; last_opened: string }[];
      };
      // Who has stopped coming (0231). weeks_absent is null for a member
      // who has never attended at all — a different fact from lapsing,
      // and one the answer says out loud rather than rounding to zero.
      gym_quiet_members: {
        Args: { p_gym_id: string; p_weeks?: number };
        Returns: {
          profile_id: string;
          full_name: string | null;
          last_seen: string | null;
          weeks_absent: number | null;
          paying: boolean;
        }[];
      };
      // Which members cannot be emailed, without saying what their address
      // is — the flag is staff-wide, the address is admin-only (0230).
      gym_unreachable_emails: {
        Args: { p_gym_id: string; p_profile_id?: string | null };
        Returns: {
          profile_id: string;
          reason: 'hard_bounce' | 'complaint';
          last_seen_at: string;
        }[];
      };
      // sent = what left, delivered = what a mailbox took, successful =
      // delivered and not bounced. tracked rides along so a caller cannot
      // render the numbers without the fact that says whether they mean
      // anything (0229).
      comms_campaign_stats: {
        Args: { p_campaign_id: string };
        Returns: {
          recipients: number;
          sent: number;
          delivered: number;
          successful: number;
          simulated: number;
          failed: number;
          bounced: number;
          complained: number;
          opened: number;
          clicked: number;
          unsubscribed: number;
          skipped: number;
          tracked: boolean;
        }[];
      };
      list_programmed_members: {
        Args: { p_gym_id: string };
        Returns: {
          profile_id: string;
          full_name: string | null;
          avatar_url: string | null;
          mode: 'free' | 'paid';
          days_total: number;
          upcoming_days: number;
          last_date: string | null;
          files_total: number;
        }[];
      };
      list_store_products: {
        Args: { p_gym_id: string };
        Returns: {
          id: string;
          name: string;
          description: string | null;
          kind: StoreProductKind;
          price_cents: number;
          image_url: string | null;
          image_urls: string[];
          track_inventory: boolean;
          stock_quantity: number | null;
          sold_out: boolean;
          recurring: boolean;
          recurring_interval: string | null;
          category: string | null;
          // jsonb: StoreVariantJson[] | null (null when the product has none)
          variants: Json;
        }[];
      };
      my_programming_access: {
        Args: { p_gym_id: string };
        Returns: {
          entitled: boolean;
          mode: 'free' | 'paid';
          has_programming: boolean;
          product_id: string | null;
          product_name: string | null;
          product_price_cents: number | null;
          product_recurring: boolean;
          product_recurring_interval: string | null;
          product_active: boolean;
          plan_upgrade_available: boolean;
        }[];
      };
      set_member_programming_access: {
        Args: {
          p_gym_id: string;
          p_profile_id: string;
          p_mode: 'free' | 'paid';
          p_store_product_id?: string | null;
        };
        Returns: null;
      };
      set_store_settings: {
        Args: {
          p_gym_id: string;
          p_enabled: boolean;
          p_shipping_fee_cents: number;
        };
        Returns: null;
      };
      staff_store_orders: {
        Args: { p_gym_id: string };
        Returns: {
          id: string;
          status: StoreOrderStatus;
          subtotal_cents: number;
          shipping_cents: number;
          total_cents: number;
          currency: string;
          has_physical: boolean;
          shipping_name: string | null;
          shipping_address: Json | null;
          tracking_note: string | null;
          buyer_name: string | null;
          item_count: number;
          items_summary: string | null;
          created_at: string;
          paid_at: string | null;
          fulfilled_at: string | null;
        }[];
      };
      fulfil_store_order: {
        Args: { p_order_id: string; p_note: string | null };
        Returns: null;
      };
      store_revenue_summary: {
        Args: {
          p_gym_id: string;
          p_period_start: string;
          p_period_end: string;
        };
        Returns: {
          currency: string;
          gross_cents: number;
          order_count: number;
        }[];
      };
      staff_store_subscriptions: {
        Args: { p_gym_id: string };
        Returns: {
          id: string;
          product_name: string | null;
          buyer_name: string | null;
          unit_price_cents: number;
          currency: string;
          interval: string;
          status: StoreSubscriptionStatus;
          cancel_at_period_end: boolean;
          current_period_end: string | null;
          created_at: string;
        }[];
      };
      update_store_subscription_shipping: {
        Args: { p_sub_id: string; p_name: string; p_address: Json };
        Returns: void;
      };
    };
    Enums: {
      gym_role: GymRole;
    };
    CompositeTypes: Record<string, never>;
  };
};
