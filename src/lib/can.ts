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
  | 'can_invite'
  | 'can_refund'
  | 'can_manage_staff';

const matrix: Record<Capability, Record<GymRole, boolean>> = {
  can_access_staff_area: { owner: true,  coach: true,  staff: true,  member: false },
  can_see_money:         { owner: true,  coach: false, staff: false, member: false },
  can_see_full_pii:      { owner: true,  coach: false, staff: false, member: false },
  can_see_email:         { owner: true,  coach: false, staff: false, member: false },
  can_see_health_flag:   { owner: true,  coach: true,  staff: true,  member: false },
  can_edit_classes:      { owner: true,  coach: true,  staff: false, member: false },
  can_check_in_member:   { owner: true,  coach: true,  staff: true,  member: false },
  can_issue_override:    { owner: true,  coach: true,  staff: true,  member: false },
  can_issue_comp_grant:  { owner: true,  coach: true,  staff: false, member: false },
  can_manage_plans:      { owner: true,  coach: false, staff: false, member: false },
  can_assign_plan:       { owner: true,  coach: true,  staff: true,  member: false },
  can_invite:            { owner: true,  coach: false, staff: false, member: false },
  can_refund:            { owner: true,  coach: false, staff: false, member: false },
  can_manage_staff:      { owner: true,  coach: false, staff: false, member: false },
};

export function can(role: GymRole | null | undefined, capability: Capability): boolean {
  if (!role) return false;
  return matrix[capability][role];
}
