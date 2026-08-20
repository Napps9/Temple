import { useState } from 'react';
import { Image, View } from 'react-native';
import { Text } from './Text';

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
      className="bg-gray-200 dark:bg-gray-700 items-center justify-center overflow-hidden">
      {showImage ? (
        <Image
          source={{ uri: avatarUrl! }}
          style={{ width: size, height: size }}
          onError={() => setFailed(true)}
        />
      ) : (
        <Text
          className="text-gray-600 dark:text-gray-300 font-semibold"
          style={{ fontSize }}>
          {initial}
        </Text>
      )}
    </View>
  );
}
