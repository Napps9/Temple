import { Text, View } from 'react-native';

export function Avatar({
  name,
  size = 40,
}: {
  name?: string | null;
  size?: number;
}) {
  const initial = (name?.charAt(0) || '?').toUpperCase();
  const fontSize = Math.max(10, Math.round(size * 0.4));
  return (
    <View
      style={{ width: size, height: size, borderRadius: size / 2 }}
      className="bg-gray-200 dark:bg-gray-700 items-center justify-center">
      <Text
        className="text-gray-600 dark:text-gray-300 font-semibold"
        style={{ fontSize }}>
        {initial}
      </Text>
    </View>
  );
}
