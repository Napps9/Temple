import { ManageModal } from '@/components/ManageModal';
import { TagRulesPanel } from '@/components/TagRulesPanel';

// The Members-tab "Tag rules" CTA opens the same rules editor the
// standalone /management/tags route uses, in a modal.
export function TagRulesModal({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  return (
    <ManageModal
      visible={visible}
      onClose={onClose}
      title="Tag rules"
      subtitle="Auto-tag members based on cohort state.">
      <TagRulesPanel />
    </ManageModal>
  );
}
