import { Link } from 'expo-router';
import { Pressable, Text } from 'react-native';

import { isStaffRole, useRole } from '@/lib/auth';

export function MemberViewLink() {
  return (
    <Link href="/(member)" asChild>
      <Pressable hitSlop={8} className="px-4">
        <Text className="text-brand">Member view →</Text>
      </Pressable>
    </Link>
  );
}

export function StaffViewLinkIfStaff() {
  const role = useRole();
  if (!isStaffRole(role)) return null;
  return (
    <Link href="/(staff)" asChild>
      <Pressable hitSlop={8} className="px-4">
        <Text className="text-brand">← Staff view</Text>
      </Pressable>
    </Link>
  );
}
