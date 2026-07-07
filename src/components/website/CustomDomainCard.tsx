import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { ChipButton } from '@/components/ChipButton';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Input } from '@/components/Input';
import {
  RecordCard,
  StatusBadge,
  StatusExplainer,
  TONE,
} from '@/components/domain/DomainCardParts';
import { useCustomDomain, useCustomDomainAction } from '@/lib/custom-domain';
import {
  domainStatusDescription,
  domainStatusMeta,
  validateCustomDomain,
  type DnsRecord,
} from '@/lib/site-domain';

export function CustomDomainCard({ gymId }: { gymId: string | null | undefined }) {
  const query = useCustomDomain(gymId);
  const action = useCustomDomainAction(gymId);

  const [domainInput, setDomainInput] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [verifyNote, setVerifyNote] = useState<{ tone: 'amber' | 'red'; text: string } | null>(
    null,
  );
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const domain = query.data;
  const records = (domain?.records as unknown as DnsRecord[] | null) ?? [];
  const actionError = action.isError ? action.error.message : null;

  function connect() {
    setFormError(null);
    const d = validateCustomDomain(domainInput);
    if (!d.ok) return setFormError(d.error);
    action.mutate({ action: 'connect', domain: d.domain });
  }

  function disconnect() {
    action.mutate({ action: 'disconnect' }, { onSettled: () => setConfirmDisconnect(false) });
  }

  // A plain success is silent (the card flips to Verified); anything else
  // says precisely what the gym is still waiting on, so a click never
  // feels like a no-op.
  function verify() {
    setVerifyNote(null);
    action.mutate(
      { action: 'verify' },
      {
        onSuccess: (data) => {
          if (data.status === 'verified') return;
          if (data.status === 'error') {
            setVerifyNote({
              tone: 'red',
              text:
                data.error_message ??
                'Something is wrong with this domain — disconnect it and connect it again.',
            });
          } else if (data.ownership_verified === false) {
            setVerifyNote({
              tone: 'amber',
              text: 'Not verified yet — we’re still waiting on the TXT ownership record. Add it exactly as shown, give DNS a few minutes, then check again.',
            });
          } else {
            setVerifyNote({
              tone: 'amber',
              text: 'Not live yet — your DNS changes haven’t propagated. This can take a few minutes (occasionally up to 48h). Leave the records in place and check again shortly.',
            });
          }
        },
      },
    );
  }

  return (
    <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3">
      <View className="flex-row items-center gap-2">
        <Text className="flex-1 text-gray-900 dark:text-gray-50 font-semibold">
          Custom domain
        </Text>
        {domain ? <StatusBadge meta={domainStatusMeta(domain.status)} /> : null}
      </View>
      {domain ? (
        // Prefer the row's own error_message: the generic 'error' copy
        // tells the gym to re-check DNS, which would mislead when the
        // real problem is e.g. the domain no longer being attached.
        <StatusExplainer
          tone={domainStatusMeta(domain.status).tone}
          text={domain.error_message ?? domainStatusDescription(domain.status)}
        />
      ) : (
        <Text className="text-gray-500 dark:text-gray-400 text-xs">
          Connect a domain you own so your site serves from it directly, instead of only
          at /site/&lt;your-slug&gt;.
        </Text>
      )}

      {query.isLoading ? (
        <ActivityIndicator />
      ) : !domain ? (
        <View className="gap-3">
          <Input
            label="Domain"
            value={domainInput}
            onChangeText={setDomainInput}
            autoCapitalize="none"
            placeholder="www.yourgym.com"
          />
          {formError ? (
            <Text className="text-red-500 dark:text-red-400 text-xs">{formError}</Text>
          ) : null}
          <Button onPress={connect} loading={action.isPending}>
            Connect domain
          </Button>
        </View>
      ) : domain.status === 'verified' ? (
        <View className="gap-3">
          <View className="flex-row items-center gap-2 bg-green-500/10 rounded-lg p-3">
            <Ionicons name="checkmark-circle" size={18} color="#16A34A" />
            <View className="flex-1">
              <Text className="text-gray-900 dark:text-gray-50 text-sm font-medium">
                Live at
              </Text>
              <Text className="text-gray-700 dark:text-gray-200 text-sm font-mono">
                {domain.domain}
              </Text>
            </View>
          </View>
          <View className="self-start">
            <ChipButton
              tone="red"
              label="Disconnect domain"
              icon="close-circle-outline"
              onPress={() => setConfirmDisconnect(true)}
              disabled={action.isPending}
            />
          </View>
        </View>
      ) : (
        <View className="gap-3">
          {/* In the 'error' state the records are noise — the explainer
              above already says the real fix (disconnect and reconnect). */}
          {domain.status !== 'error' ? (
            <>
              <Text className="text-gray-700 dark:text-gray-200 text-sm">
                Add these records at the registrar for{' '}
                <Text className="font-mono">{domain.domain}</Text>.
              </Text>

              {records.length === 0 ? (
                <Text className="text-gray-500 dark:text-gray-400 text-sm">
                  No records returned yet — try verifying.
                </Text>
              ) : (
                <View className="gap-2">
                  {records.map((r, i) => (
                    <RecordCard key={`${r.type}-${r.name}-${i}`} record={r} />
                  ))}
                </View>
              )}
            </>
          ) : null}

          {verifyNote ? (
            <View className={`rounded-lg p-3 ${TONE[verifyNote.tone].bg}`}>
              <Text className={`text-xs ${TONE[verifyNote.tone].text}`}>{verifyNote.text}</Text>
            </View>
          ) : null}

          <Button onPress={verify} loading={action.isPending}>
            I’ve added the records — verify
          </Button>
          <View className="self-start">
            <ChipButton
              tone="red"
              label="Disconnect domain"
              icon="close-circle-outline"
              onPress={() => setConfirmDisconnect(true)}
              disabled={action.isPending}
            />
          </View>
        </View>
      )}

      {actionError ? (
        <Text className="text-red-500 dark:text-red-400 text-xs">{actionError}</Text>
      ) : null}

      <ConfirmDialog
        visible={confirmDisconnect}
        title="Disconnect this domain?"
        body={
          domain?.status === 'verified'
            ? `Your site is currently live at ${domain.domain}. Disconnecting takes it offline until you reconnect and re-verify.`
            : "You'll need to reconnect and re-verify DNS if you want to use this domain again."
        }
        confirmLabel="Disconnect"
        pending={action.isPending}
        onConfirm={disconnect}
        onCancel={() => setConfirmDisconnect(false)}
      />
    </View>
  );
}
