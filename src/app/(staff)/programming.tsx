import { ProgrammingCalendar } from '@/components/ProgrammingCalendar';
import { useCan } from '@/lib/useCan';

export default function StaffProgramming() {
  const canEdit = useCan('can_edit_classes') ?? false;
  return <ProgrammingCalendar mode={canEdit ? 'manage' : 'view'} />;
}
