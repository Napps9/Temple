import { ProgrammingCalendar } from '@/components/ProgrammingCalendar';
import { useRole } from '@/lib/auth';

export default function StaffProgramming() {
  const role = useRole();
  const canManage = role === 'owner' || role === 'coach';
  return <ProgrammingCalendar mode={canManage ? 'manage' : 'view'} />;
}
