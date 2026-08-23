import type { GymRole } from '@/types/database';

export type Capability =
  | 'can_access_staff_area'
  | 'can_see_money'
  | 'can_see_full_pii'
  | 'can_see_email'
  | 'can_see_health_flag'
  | 'can_edit_classes'
  | 'can_check_in_member'
  | 'can_issue_override'
  | 'can_issue_comp_grant'
  | 'can_manage_plans'
  | 'can_assign_plan'
  | 'can_work_leads'
  | 'can_invite'
  | 'can_refund'
  | 'can_manage_staff'
  | 'can_see_insights'
  | 'can_set_targets'
  | 'can_export_members'
  | 'can_manage_tags'
  | 'can_manage_tasks'
  | 'can_request_cover'
  | 'can_claim_cover'
  | 'can_manage_sops'
  | 'can_view_sops'
  | 'can_view_attendance'
  | 'can_archive_classes'
  | 'can_archive_plans'
  | 'can_archive_members'
  | 'can_hard_delete'
  | 'can_see_workout_logs'
  | 'can_set_coach_pay'
  | 'can_configure_leaderboards'
  | 'can_post_announcements'
  | 'can_broadcast_to_class'
  | 'can_manage_parq'
  | 'can_acknowledge_alerts'
  | 'can_manage_comms'
  | 'can_manage_store'
  | 'can_see_store_revenue'
  | 'can_program_members'
  | 'can_review_ai_calls'
  | 'can_bulk_edit_classes';

const matrix: Record<Capability, Record<GymRole, boolean>> = {
  can_access_staff_area: { owner: true,  admin: true,  coach: true,  staff: true,  member: false },
  can_see_money:         { owner: true,  admin: false, coach: false, staff: false, member: false },
  can_see_full_pii:      { owner: true,  admin: true,  coach: false, staff: false, member: false },
  can_see_email:         { owner: true,  admin: true,  coach: false, staff: false, member: false },
  can_see_health_flag:   { owner: true,  admin: true,  coach: true,  staff: true,  member: false },
  can_edit_classes:      { owner: true,  admin: true,  coach: true,  staff: false, member: false },
  can_check_in_member:   { owner: true,  admin: true,  coach: true,  staff: true,  member: false },
  can_issue_override:    { owner: true,  admin: true,  coach: true,  staff: true,  member: false },
  can_issue_comp_grant:  { owner: true,  admin: true,  coach: true,  staff: false, member: false },
  can_manage_plans:      { owner: true,  admin: false, coach: false, staff: false, member: false },
  can_assign_plan:       { owner: true,  admin: true,  coach: true,  staff: true,  member: false },
  can_work_leads:        { owner: true,  admin: true,  coach: true,  staff: true,  member: false },
  can_invite:            { owner: true,  admin: true,  coach: false, staff: false, member: false },
  can_refund:            { owner: true,  admin: false, coach: false, staff: false, member: false },
  can_manage_staff:      { owner: true,  admin: true,  coach: false, staff: false, member: false },
  can_see_insights:      { owner: true,  admin: true,  coach: false, staff: false, member: false },
  can_set_targets:       { owner: true,  admin: false, coach: false, staff: false, member: false },
  can_export_members:    { owner: true,  admin: true,  coach: false, staff: false, member: false },
  can_manage_tags:       { owner: true,  admin: true,  coach: false, staff: false, member: false },
  can_manage_tasks:      { owner: true,  admin: true,  coach: true,  staff: false, member: false },
  can_request_cover:     { owner: true,  admin: false, coach: true,  staff: false, member: false },
  can_claim_cover:       { owner: true,  admin: false, coach: true,  staff: false, member: false },
  can_manage_sops:       { owner: true,  admin: true,  coach: false, staff: false, member: false },
  can_view_sops:         { owner: true,  admin: true,  coach: true,  staff: true,  member: false },
  can_view_attendance:   { owner: true,  admin: true,  coach: true,  staff: true,  member: false },
  can_archive_classes:   { owner: true,  admin: true,  coach: true,  staff: false, member: false },
  can_archive_plans:     { owner: true,  admin: false, coach: false, staff: false, member: false },
  can_archive_members:   { owner: true,  admin: true,  coach: false, staff: false, member: false },
  can_hard_delete:       { owner: true,  admin: false, coach: false, staff: false, member: false },
  can_see_workout_logs:  { owner: true,  admin: true,  coach: true,  staff: false, member: false },
  can_set_coach_pay:     { owner: true,  admin: false, coach: false, staff: false, member: false },
  can_configure_leaderboards: { owner: true, admin: false, coach: false, staff: false, member: false },
  can_post_announcements: { owner: true, admin: true,  coach: true,  staff: false, member: false },
  can_broadcast_to_class: { owner: true, admin: true,  coach: true,  staff: false, member: false },
  can_manage_parq:        { owner: true, admin: true,  coach: false, staff: false, member: false },
  can_acknowledge_alerts: { owner: true, admin: true,  coach: true,  staff: false, member: false },
  can_manage_comms:       { owner: true, admin: true,  coach: false, staff: false, member: false },
  can_manage_store:       { owner: true, admin: true,  coach: false, staff: false, member: false },
  can_see_store_revenue:  { owner: true, admin: true,  coach: false, staff: false, member: false },
  can_program_members:    { owner: true, admin: true,  coach: true,  staff: false, member: false },
  can_review_ai_calls:    { owner: true, admin: true,  coach: false, staff: false, member: false },
  can_bulk_edit_classes:  { owner: true, admin: true,  coach: false, staff: false, member: false },
};

export const RoleOrder: GymRole[] = ['owner', 'admin', 'coach', 'staff', 'member'];

export function can(role: GymRole | null | undefined, capability: Capability): boolean {
  if (!role) return false;
  return matrix[capability][role];
}
