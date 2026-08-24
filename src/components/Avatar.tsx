import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { Image, View } from 'react-native';

import { Text } from './Text';
import { DAWN } from '@/lib/theme';

export function Avatar({
  name,
  avatarUrl,
  size = 40,
}: {
  name?: string | null;
  avatarUrl?: string | null;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  const initial = (name?.charAt(0) || '?').toUpperCase();
  const fontSize = Math.max(10, Math.round(size * 0.4));
  const showImage = !!avatarUrl && !failed;
  return (
    <View
      style={{ width: size, height: size, borderRadius: size / 2 }}
      className="bg-sunken dark:bg-sunken-dk items-center justify-center overflow-hidden">
      {showImage ? (
        <Image
          source={{ uri: avatarUrl! }}
          style={{ width: size, height: size }}
          onError={() => setFailed(true)}
        />
      ) : (
        <LinearGradient
          colors={[...DAWN.light]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
          <Text className="font-semibold" style={{ fontSize, color: '#FFFFFF' }}>
            {initial}
          </Text>
        </LinearGradient>
      )}
    </View>
  );
}
