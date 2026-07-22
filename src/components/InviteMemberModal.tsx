import { InviteSection } from '@/components/InviteSection';
import { ManageModal } from '@/components/ManageModal';
import { MemberSignupLinkCard } from '@/components/MemberSignupLinkCard';

// The Members-tab "Invite a member" CTA opens this: the email-invite form
// and the public signup link + QR that used to sit inline on the tab,
// stacked in one modal so the tab itself stays lean.
export function InviteMemberModal({
  visible,
  onClose,
  canInvite,
}: {
  visible: boolean;
  onClose: () => void;
  canInvite: boolean;
}) {
  return (
    <ManageModal
      visible={visible}
      onClose={onClose}
      title="Invite a member"
      subtitle="Email an invite, or share the branded signup link and QR.">
      {canInvite ? (
        <InviteSection
          title="Email an invite"
          subtitle="Send a member a one-tap link to join your gym."
          roles={['member']}
          initialRole="member"
        />
      ) : null}
      <MemberSignupLinkCard />
    </ManageModal>
  );
}
