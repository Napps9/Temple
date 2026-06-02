import { Stack } from 'expo-router';

export default function ManagementLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: '#F9FAFB' },
        animation: 'none',
      }}
    />
  );
}
