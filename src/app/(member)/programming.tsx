import { ProgrammingCalendar } from '@/components/ProgrammingCalendar';

export default function MemberProgramming() {
  // showMyPercentages is set only here: this is the one surface where
  // the viewer and the athlete the programming is for are the same
  // person, so resolving "@ 75%" against the viewer's rep maxes is
  // correct. The staff surfaces share this component.
  return <ProgrammingCalendar mode="view" showMyPercentages />;
}
