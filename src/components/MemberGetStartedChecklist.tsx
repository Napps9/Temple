import { Ionicons } from '@expo/vector-icons';
import { router, usePathname } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from './Text';

import { StatusDisk } from '@/components/StatusDisk';
import {
  useMemberOnboarding,
  type OnboardingStepKey,
} from '@/lib/useMemberOnboarding';
import { useSetOnboardingFlag } from '@/lib/useOnboardingFlags';
import { useThemeColors } from '@/lib/theme';

// New-member onboarding nudge, pinned to the top of the Book screen so a
// first-time member can't miss how to get a membership. Expanded by
// default; each step is derived from live data and the whole thing
// disappears once every *required* step is done. Members only — the
// underlying hook returns null for staff.

function routeFor(key: OnboardingStepKey): string {
  switch (key) {
    case 'membership':
      return '/membership';
    case 'book':
      return '/book';
    case 'programming':
      // Group-qualified: '/programming' also matches (staff)'s route.
      return '/(member)/programming';
    case 'log':
      return '/track';
    case 'injury':
      return '/injury-check';
  }
}

export function MemberGetStartedChecklist() {
  const colors = useThemeColors();
  const setFlag = useSetOnboardingFlag();
  const onboarding = useMemberOnboarding();
  const pathname = usePathname();
  const [open, setOpen] = useState(true);

  if (!onboarding) return null;
  const { gymName, steps, requiredDone, requiredTotal } = onboarding;

  const runStep = (key: OnboardingStepKey) => {
    if (key === 'programming') setFlag('programming_peeked');
    const route = routeFor(key);
    // The nudge is pinned to the Book screen, so "Book your first class"
    // would navigate to the page we're already on — a dead tap. Collapse
    // instead so the schedule sitting right below is unobstructed.
    if (pathname === route) {
      setOpen(false);
      return;
    }
    router.push(route as never);
  };

  const dismiss = () => {
    setFlag('getstarted_dismissed');
  };

  return (
    <View className="bg-raised dark:bg-raised-dk/40 rounded-card p-3 gap-3 border border-primary/20">
      <Pressable
        onPress={() => setOpen((v) => !v)}
        className="flex-row items-center gap-3 active:opacity-70">
        <View className="w-10 h-10 rounded-full bg-primary/15 items-center justify-center">
          <Ionicons name="rocket-outline" size={20} color={colors.primary} />
        </View>
        <View className="flex-1">
          <Text className="text-ink dark:text-ink-dk font-semibold text-sm">
            Get the most out of {gymName}
          </Text>
          <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
            {requiredDone} of {requiredTotal} done
          </Text>
        </View>
        <Pressable
          onPress={dismiss}
          hitSlop={8}
          accessibilityLabel="Dismiss get-started tips"
          className="w-7 h-7 items-center justify-center active:opacity-60">
          <Ionicons name="close" size={18} color={colors.ink3} />
        </Pressable>
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={colors.ink3}
        />
      </Pressable>

      <View className="h-2 rounded-full bg-sunken dark:bg-raised-dk overflow-hidden">
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
              className="flex-row items-center gap-3 rounded-ctl px-3 py-2.5 bg-surface dark:bg-surface-dk active:opacity-70">
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
                        ? 'text-ink-3 dark:text-ink-3-dk line-through'
                        : 'text-ink dark:text-ink-dk'
                    }`}>
                    {step.label}
                  </Text>
                  {step.optional && !step.done ? (
                    <Text className="text-[10px] font-semibold uppercase tracking-wide text-ink-3 dark:text-ink-3-dk bg-sunken dark:bg-sunken-dk px-1.5 py-0.5 rounded">
                      Optional
                    </Text>
                  ) : null}
                </View>
                {!step.done ? (
                  <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                    {step.description}
                  </Text>
                ) : null}
              </View>
              <Ionicons
                name="chevron-forward"
                size={15}
                color={step.done ? colors.ink2 : colors.ink3}
              />
            </Pressable>
          ))}

          <Pressable
            onPress={dismiss}
            hitSlop={6}
            className="items-center py-2 active:opacity-60">
            <Text className="text-ink-3 dark:text-ink-3-dk text-xs font-medium">
              Skip for now
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
