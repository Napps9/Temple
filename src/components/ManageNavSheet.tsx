import { router } from 'expo-router';
import { View } from 'react-native';

import { IconTile, ListRow, RuledList } from '@/components/ListRow';
import { Sheet } from '@/components/Sheet';
import { useGymBrand } from '@/lib/useGymBrand';
import { useGymNavLinks } from '@/lib/useGymNavLinks';

// What the staff rail shows at 1024+, as a sheet for the widths that
// have no rail: tapping the Manage pill opens the gym's destinations
// directly instead of routing every jump through the hub page. The hub
// keeps everything else — search, team, tasks, settings — so it leads
// the list, where the pill used to land.
export function ManageNavSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const brand = useGymBrand();
  const links = useGymNavLinks();

  return (
    <Sheet visible={visible} onClose={onClose} title={brand.gymName} dialogWidth={420}>
      <View className="pb-4">
      <RuledList>
        <ListRow
          ruled
          first
          lead={<IconTile name="settings-outline" />}
          title="Manage"
          subtitle="Search, team, tasks, settings — everything else"
          onPress={() => {
            onClose();
            router.replace('/management' as never);
          }}
        />
        {links.map((l) => (
          <ListRow
            key={l.href}
            ruled
            lead={<IconTile name={l.icon} />}
            title={l.label}
            onPress={() => {
              onClose();
              router.push(l.href as never);
            }}
          />
        ))}
      </RuledList>
      </View>
    </Sheet>
  );
}
