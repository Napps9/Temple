import { ProgrammingCalendar } from '@/components/ProgrammingCalendar';
import { useRole } from '@/lib/auth';
import { can } from '@/lib/can';

export default function StaffProgramming() {
  const role = useRole();
  return <ProgrammingCalendar mode={can(role, 'can_edit_classes') ? 'manage' : 'view'} />;
}
