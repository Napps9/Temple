import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { StatusDisk } from '@/components/StatusDisk';
import {
  useMemberOnboarding,
  type OnboardingStepKey,
} from '@/lib/useMemberOnboarding';
import { useSetOnboardingFlag } from '@/lib/useOnboardingFlags';
import { useThemeColors } from '@/lib/theme';

// New-member onboarding nudge. Lives inside the account menu now (under
// the profile picture); the avatar carries a dot while it's unfinished so
// members still notice it. Each step is derived from live data and the
// whole thing disappears once every *required* step is done. Members
// only — the underlying hook returns null for staff.
//
// onNavigate fires after any tap that leaves the checklist (a step, or
// "Skip"), so the host can close the menu it sits in.

function routeFor(key: OnboardingStepKey): string {
  switch (key) {
    case 'membership':
      return '/membership';
    case 'book':
      return '/book';
    case 'programming':
      return '/programming';
    case 'log':
      return '/track';
    case 'injury':
      return '/injury-check';
  }
}

export function MemberGetStartedChecklist({
  onNavigate,
}: {
  onNavigate?: () => void;
}) {
  const colors = useThemeColors();
  const setFlag = useSetOnboardingFlag();
  const onboarding = useMemberOnboarding();
  const [open, setOpen] = useState(false);

  if (!onboarding) return null;
  const { gymName, steps, requiredDone, requiredTotal } = onboarding;

  const runStep = (key: OnboardingStepKey) => {
    if (key === 'programming') setFlag('programming_peeked');
    router.push(routeFor(key) as never);
    onNavigate?.();
  };

  const dismiss = () => {
    setFlag('getstarted_dismissed');
    onNavigate?.();
  };

  return (
    <View className="bg-gray-50 dark:bg-gray-800/40 rounded-2xl p-3 gap-3 border border-primary/20">
      <Pressable
        onPress={() => setOpen((v) => !v)}
        className="flex-row items-center gap-3 active:opacity-70">
        <View className="w-10 h-10 rounded-full bg-primary/15 items-center justify-center">
          <Ionicons name="rocket-outline" size={20} color={colors.primary} />
        </View>
        <View className="flex-1">
          <Text className="text-gray-900 dark:text-gray-50 font-semibold text-sm">
            Get the most out of {gymName}
          </Text>
          <Text className="text-gray-500 dark:text-gray-400 text-xs">
            {requiredDone} of {requiredTotal} done
          </Text>
        </View>
        <Pressable
          onPress={dismiss}
          hitSlop={8}
          accessibilityLabel="Dismiss get-started tips"
          className="w-7 h-7 items-center justify-center active:opacity-60">
          <Ionicons name="close" size={18} color={colors.iconTertiary} />
        </Pressable>
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={colors.iconTertiary}
        />
      </Pressable>

      <View className="h-2 rounded-full bg-gray-200 dark:bg-gray-800 overflow-hidden">
        <View
          style={{ width: `${(requiredDone / requiredTotal) * 100}%` }}
          className="h-full bg-primary rounded-full"
        />
      </View>

      {open ? (
        <View className="gap-1.5">
          {steps.map((step) => (
            <Pressable
              key={step.key}
              onPress={() => runStep(step.key)}
              className="flex-row items-center gap-3 rounded-lg px-3 py-2.5 bg-white dark:bg-gray-800 active:opacity-70">
              <StatusDisk
                size={28}
                done={step.done}
                partial={false}
                complete={step.done ? 1 : 0}
                target={1}
                icon={step.icon}
                accent={colors.primary}
              />
              <View className="flex-1">
                <View className="flex-row items-center gap-2">
                  <Text
                    className={`text-sm font-medium ${
                      step.done
                        ? 'text-gray-400 dark:text-gray-500 line-through'
                        : 'text-gray-900 dark:text-gray-50'
                    }`}>
                    {step.label}
                  </Text>
                  {step.optional && !step.done ? (
                    <Text className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 bg-gray-200 dark:bg-gray-700 px-1.5 py-0.5 rounded">
                      Optional
                    </Text>
                  ) : null}
                </View>
                {!step.done ? (
                  <Text className="text-gray-500 dark:text-gray-400 text-xs">
                    {step.description}
                  </Text>
                ) : null}
              </View>
              <Ionicons
                name="chevron-forward"
                size={16}
                color={step.done ? colors.iconSecondary : colors.iconTertiary}
              />
            </Pressable>
          ))}

          <Pressable
            onPress={dismiss}
            hitSlop={6}
            className="items-center py-2 active:opacity-60">
            <Text className="text-gray-400 dark:text-gray-500 text-xs font-medium">
              Skip for now
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
