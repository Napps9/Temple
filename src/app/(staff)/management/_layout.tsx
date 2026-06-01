import { Stack } from 'expo-router';

export default function ManagementLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: '#0B1220' },
        animation: 'none',
      }}
    />
  );
}
