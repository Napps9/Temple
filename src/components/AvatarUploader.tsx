import * as ImagePicker from 'expo-image-picker';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Avatar } from './Avatar';
import { useSession } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

export function AvatarUploader({
  currentUrl,
  fullName,
  size = 80,
}: {
  currentUrl?: string | null;
  fullName?: string | null;
  size?: number;
}) {
  const session = useSession();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const upload = useMutation({
    mutationFn: async () => {
      if (!session?.user.id) throw new Error('Not signed in');
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) throw new Error('Photo library permission denied');

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });
      if (result.canceled || result.assets.length === 0) return null;
      const asset = result.assets[0];

      const response = await fetch(asset.uri);
      const blob = await response.blob();
      const ext = asset.uri.split('.').pop()?.toLowerCase() || 'jpg';
      const path = `${session.user.id}/${Date.now()}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from('avatars')
        .upload(path, blob, {
          contentType: asset.mimeType ?? `image/${ext}`,
          upsert: false,
        });
      if (upErr) throw upErr;

      const { data: publicUrl } = supabase.storage
        .from('avatars')
        .getPublicUrl(path);

      const { error: rpcErr } = await supabase.rpc('set_avatar_url', {
        p_url: publicUrl.publicUrl,
      });
      if (rpcErr) throw rpcErr;

      return publicUrl.publicUrl;
    },
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['my-profile'] });
    },
    onError: (e) => setError(errorMessage(e, 'Could not upload avatar')),
  });

  return (
    <View className="flex-row items-center gap-3">
      <Avatar name={fullName} avatarUrl={currentUrl} size={size} />
      <View className="flex-1 gap-1">
        <Pressable
          onPress={() => upload.mutate()}
          disabled={upload.isPending}
          className="self-start px-3 py-1.5 rounded-md border border-gray-200 dark:border-gray-700 active:bg-gray-50 dark:active:bg-gray-800">
          <Text className="text-gray-700 dark:text-gray-200 text-xs uppercase tracking-widest">
            {upload.isPending ? 'Uploading…' : currentUrl ? 'Change photo' : 'Upload photo'}
          </Text>
        </Pressable>
        {error ? (
          <Text className="text-red-500 dark:text-red-400 text-xs">{error}</Text>
        ) : null}
      </View>
    </View>
  );
}
