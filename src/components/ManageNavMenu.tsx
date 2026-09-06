import { router } from 'expo-router';
import { View } from 'react-native';

import { DockMenu, MenuDivider, MenuRow } from './DockMenu';
import { Text } from './Text';
import { useThemeColors } from '@/lib/theme';
import { useGymBrand } from '@/lib/useGymBrand';
import { useGymNavLinks } from '@/lib/useGymNavLinks';

// What the staff rail shows at 1024+, as the phone dock's Manage menu:
// the same popover the avatar opens, hung above the dock, listing the
// gym's destinations directly instead of routing every jump through the
// hub page. The hub keeps everything else — search, team, tasks,
// settings — so it leads the list, where the pill used to land.
export function ManageNavMenu({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const brand = useGymBrand();
  const links = useGymNavLinks();
  const colors = useThemeColors();

  function go(href: string, replace = false) {
    onClose();
    if (replace) router.replace(href as never);
    else router.push(href as never);
  }

  return (
    <DockMenu visible={visible} onClose={onClose} anchor="bottom-right">
      <View className="px-3 py-2">
        <Text
          className="text-ink dark:text-ink-dk font-semibold text-base"
          numberOfLines={1}>
          {brand.gymName}
        </Text>
      </View>
      <MenuDivider />
      <MenuRow
        icon="settings-outline"
        label="Manage"
        subtitle="Search, team, tasks, settings — everything else"
        iconColor={colors.ink}
        onPress={() => go('/management', true)}
      />
      {links.map((l) => (
        <MenuRow
          key={l.href}
          icon={l.icon}
          label={l.label}
          iconColor={colors.ink}
          onPress={() => go(l.href)}
        />
      ))}
    </DockMenu>
  );
}
