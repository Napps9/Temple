import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Text } from './Text';

import { errorMessage } from '@/lib/errors';
import { haptic } from '@/lib/haptic';
import { supabase } from '@/lib/supabase';

type Props = {
  bookingId: string;
  sessionId: string;
  attendedAt: string | null;
  noShow: boolean;
  isOpen: boolean;
};

export function CheckInButton({
  bookingId,
  sessionId,
  attendedAt,
  noShow,
  isOpen,
}: Props) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['class-bookings', sessionId] });
    setError(null);
  };

  const attend = useMutation({
    mutationFn: async () => {
      const { error: e } = await supabase.rpc('check_in_member', {
        p_booking_id: bookingId,
      });
      if (e) throw e;
    },
    onSuccess: () => {
      haptic.success();
      invalidate();
    },
    onError: (e) => {
      haptic.error();
      setError(errorMessage(e, 'Could not check in'));
    },
  });

  const noShowMutation = useMutation({
    mutationFn: async () => {
      const { error: e } = await supabase.rpc('mark_no_show', {
        p_booking_id: bookingId,
      });
      if (e) throw e;
    },
    onSuccess: () => {
      haptic.warning();
      invalidate();
    },
    onError: (e) => {
      haptic.error();
      setError(errorMessage(e, 'Could not mark no-show'));
    },
  });

  const isAttended = attendedAt !== null;
  const pending = attend.isPending || noShowMutation.isPending;
  const disabled = !isOpen || pending;

  return (
    <View className="gap-1">
      <View className="flex-row gap-1">
        <Pill
          icon="checkmark"
          tone="green"
          active={isAttended}
          disabled={disabled || isAttended}
          loading={attend.isPending}
          onPress={() => attend.mutate()}
          label="Mark attended"
        />
        <Pill
          icon="close"
          tone="red"
          active={noShow}
          disabled={disabled || noShow}
          loading={noShowMutation.isPending}
          onPress={() => noShowMutation.mutate()}
          label="Mark no-show"
        />
      </View>
      {error ? (
        <Text className="text-red-500 dark:text-red-400 text-xs">{error}</Text>
      ) : null}
    </View>
  );
}

function Pill({
  icon,
  tone,
  active,
  disabled,
  loading,
  onPress,
  label,
}: {
  icon: 'checkmark' | 'close';
  tone: 'green' | 'red';
  active: boolean;
  disabled: boolean;
  loading: boolean;
  onPress: () => void;
  label: string;
}) {
  const fillClass =
    active
      ? tone === 'green'
        ? 'bg-green-600 border-green-600'
        : 'bg-red-600 border-red-600'
      : 'bg-surface dark:bg-surface-dk border-line dark:border-line-dk';
  const iconColor = active
    ? '#FFFFFF'
    : tone === 'green'
      ? '#16A34A'
      : '#DC2626';

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={label}
      hitSlop={6}
      className={`w-9 h-9 rounded-full border items-center justify-center ${fillClass} ${
        disabled ? 'opacity-40' : ''
      }`}>
      {loading ? (
        <ActivityIndicator size="small" color={active ? '#FFFFFF' : '#6B7280'} />
      ) : (
        <Ionicons name={icon} size={18} color={iconColor} />
      )}
    </Pressable>
  );
}
