import { Text, TextInput, type TextInputProps, View } from 'react-native';

type Props = TextInputProps & {
  label: string;
  error?: string;
};

export function Input({ label, error, ...props }: Props) {
  return (
    <View className="gap-1.5">
      <Text className="text-gray-700 text-sm font-medium">{label}</Text>
      <TextInput
        className="bg-white border border-gray-200 rounded-lg px-4 py-3 text-gray-900 text-base"
        placeholderTextColor="#9CA3AF"
        autoCapitalize="none"
        autoCorrect={false}
        {...props}
      />
      {error ? <Text className="text-red-500 text-xs">{error}</Text> : null}
    </View>
  );
}
