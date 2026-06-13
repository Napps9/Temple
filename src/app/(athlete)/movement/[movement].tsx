import { useLocalSearchParams } from 'expo-router';

import { MovementDetailView } from '@/components/MovementDetailView';

export default function AthleteMovementDetail() {
  const { movement } = useLocalSearchParams<{ movement: string }>();
  return <MovementDetailView movementKey={movement ?? ''} mode="athlete" />;
}
