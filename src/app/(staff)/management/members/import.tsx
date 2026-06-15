import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { BackLink } from '@/components/BackLink';
import { Button } from '@/components/Button';
import { ChipButton } from '@/components/ChipButton';
import { Screen } from '@/components/Screen';
import { useGymMembership } from '@/lib/auth';
import { joinUrl } from '@/lib/brand';
import { errorMessage } from '@/lib/errors';
import {
  autoDetect,
  buildImportRow,
  TEMPLE_FIELD_LABELS,
  type TempleField,
} from '@/lib/import/columns';
import { parseCsv } from '@/lib/import/csv';
import { supabase } from '@/lib/supabase';
import { useGymBrand } from '@/lib/useGymBrand';
import type { Json } from '@/types/database';

// Single-file import wizard. Three local phases:
//   1. upload  — drop / paste a CSV
//   2. map     — auto-detect columns, owner adjusts misses
//   3. preview — sample rows + counts, commit calls
//                import_pending_members and lands on the handover
//                screen embedded below.
//
// Self-serve is the default: after import we show the gym's join URL
// + QR + a per-member CSV the owner can mail-merge from their own
// tool. The opt-in "Send the welcome email from Temple" button
// creates a campaign with audience.kind='pending_members' and lands
// the owner in the campaign editor so they can preview before send.

type Phase = 'upload' | 'map' | 'preview' | 'handover';

type ImportResult = {
  inserted: number;
  updated: number;
  skipped: number;
};

const FIELD_OPTIONS: { key: TempleField | 'ignore'; label: string }[] = [
  { key: 'ignore', label: 'Ignore' },
  ...(Object.entries(TEMPLE_FIELD_LABELS).map(([key, label]) => ({
    key: key as TempleField,
    label,
  }))),
];

export default function ImportMembersScreen() {
  const { data: membership } = useGymMembership();
  const brand = useGymBrand();
  const queryClient = useQueryClient();

  const [phase, setPhase] = useState<Phase>('upload');
  const [csvText, setCsvText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [mapping, setMapping] = useState<(TempleField | 'ignore' | null)[]>([]);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  const fileInput = useRef<HTMLInputElement | null>(null);

  const parsed = useMemo(() => (csvText ? parseCsv(csvText) : []), [csvText]);
  const headers = parsed[0] ?? [];
  const rows = parsed.slice(1).filter((r) => r.some((c) => c.length > 0));

  function onFile(file: File) {
    setError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      setCsvText(text);
      const auto = autoDetect((parseCsv(text)[0] ?? []));
      setMapping(auto.map((f) => f ?? 'ignore'));
      setPhase('map');
    };
    reader.onerror = () => setError("Couldn't read that file.");
    reader.readAsText(file);
  }

  // Build the RPC payload from the mapped rows. Skips rows with no
  // email (the RPC also skips them; we filter here for an honest
  // preview count).
  const importRows = useMemo(() => {
    if (phase !== 'preview' && phase !== 'map') return [];
    return rows
      .map((cells) =>
        buildImportRow(
          headers,
          mapping.map((m) => (m === 'ignore' ? null : m)) as (TempleField | null)[],
          cells,
        ),
      )
      .filter((r) => typeof r.email === 'string' && (r.email as string).length > 0);
  }, [rows, headers, mapping, phase]);

  const commit = useMutation({
    mutationFn: async () => {
      if (!membership) throw new Error('Missing context');
      const { data, error: e } = await supabase.rpc('import_pending_members', {
        p_gym_id: membership.gymId,
        p_rows: importRows as unknown as Json,
      });
      if (e) throw e;
      const row = (data ?? [])[0] as ImportResult | undefined;
      return row ?? { inserted: 0, updated: 0, skipped: 0 };
    },
    onSuccess: (r) => {
      setImportResult(r);
      setPhase('handover');
      queryClient.invalidateQueries({ queryKey: ['pending-members-stats'] });
    },
    onError: (e) => setError(errorMessage(e, 'Could not import the file')),
  });

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-5 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <BackLink label="Manage" />

        <View className="gap-1">
          <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
            Import members
          </Text>
          <Text className="text-gray-500 dark:text-gray-400">
            Drop in a CSV from your previous platform (Mindbody, PushPress,
            Glofox, Wodify, a spreadsheet…). We stage the rows; members
            link to their data when they sign up at your join link.
          </Text>
        </View>

        {phase === 'upload' ? (
          <View className="gap-3 bg-white dark:bg-gray-900 rounded-xl p-4">
            {Platform.OS === 'web' ? (
              <>
                {/* A real <div> rather than <Pressable> so the standard
                    HTML drag events fire — React Native Web's Pressable
                    swallows onDragOver / onDrop. */}
                <div
                  onClick={() => fileInput.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
                    if (!dragOver) setDragOver(true);
                  }}
                  onDragEnter={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setDragOver(true);
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setDragOver(false);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setDragOver(false);
                    const f = e.dataTransfer?.files?.[0];
                    if (f) onFile(f);
                  }}
                  className={`border-2 border-dashed rounded-xl p-8 items-center gap-2 cursor-pointer transition-colors ${
                    dragOver
                      ? 'border-primary bg-primary/5'
                      : 'border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/40'
                  }`}
                  style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <Ionicons name="cloud-upload-outline" size={24} color="#6B7280" />
                  <Text className="text-gray-700 dark:text-gray-200 font-medium">
                    {dragOver ? 'Drop to upload' : 'Drop a CSV here or tap to choose a file'}
                  </Text>
                  <Text className="text-gray-500 dark:text-gray-400 text-xs">
                    .csv exports from Mindbody, PushPress, Glofox, Wodify or a
                    spreadsheet. Headers in row 1.
                  </Text>
                </div>
                {/* Hidden file input for the click-to-choose path. */}
                <input
                  ref={(el) => {
                    fileInput.current = el;
                  }}
                  type="file"
                  accept=".csv,text/csv"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onFile(f);
                    e.target.value = '';
                  }}
                />
              </>
            ) : null}

            <Text className="text-gray-500 dark:text-gray-400 text-xs">
              Or paste the CSV content here:
            </Text>
            <TextInput
              value={csvText}
              onChangeText={setCsvText}
              multiline
              numberOfLines={6}
              placeholder="Email,First Name,Last Name,Plan,Start Date..."
              placeholderTextColor="#9CA3AF"
              autoCapitalize="none"
              autoCorrect={false}
              style={{ minHeight: 140, textAlignVertical: 'top' }}
              className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-gray-900 dark:text-gray-50 text-sm font-mono"
            />

            {error ? (
              <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
            ) : null}
            <Button
              onPress={() => {
                if (parsed.length < 2) {
                  setError('Need at least a header row + one data row.');
                  return;
                }
                setMapping(autoDetect(headers).map((f) => f ?? 'ignore'));
                setPhase('map');
              }}
              disabled={!csvText.trim()}>
              Continue
            </Button>
          </View>
        ) : null}

        {phase === 'map' ? (
          <View className="gap-3 bg-white dark:bg-gray-900 rounded-xl p-4">
            <View className="gap-1">
              <Text className="text-gray-900 dark:text-gray-50 font-semibold">
                Map your columns
              </Text>
              <Text className="text-gray-500 dark:text-gray-400 text-xs">
                We auto-detected what we could. Adjust anything that's wrong.
                Columns set to "Ignore" are dropped.
              </Text>
            </View>
            <View className="gap-2">
              {headers.map((h, i) => (
                <View
                  key={`${h}-${i}`}
                  className="flex-row items-center gap-2 bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-2">
                  <Text
                    className="flex-1 text-gray-900 dark:text-gray-50 text-sm"
                    numberOfLines={1}>
                    {h || `(column ${i + 1})`}
                  </Text>
                  <Ionicons name="arrow-forward" size={14} color="#9CA3AF" />
                  <FieldPicker
                    value={mapping[i] ?? 'ignore'}
                    onChange={(v) =>
                      setMapping((m) => m.map((x, idx) => (idx === i ? v : x)))
                    }
                  />
                </View>
              ))}
            </View>
            <View className="flex-row gap-2 pt-2">
              <Button variant="secondary" onPress={() => setPhase('upload')}>
                Back
              </Button>
              <View className="flex-1" />
              <Button
                onPress={() => {
                  if (!mapping.includes('email')) {
                    setError('Map one column to Email — we need it to link signups.');
                    return;
                  }
                  setError(null);
                  setPhase('preview');
                }}>
                Preview
              </Button>
            </View>
            {error ? (
              <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
            ) : null}
          </View>
        ) : null}

        {phase === 'preview' ? (
          <View className="gap-3 bg-white dark:bg-gray-900 rounded-xl p-4">
            <Text className="text-gray-900 dark:text-gray-50 font-semibold">
              Preview
            </Text>
            <Text className="text-gray-500 dark:text-gray-400 text-xs">
              {importRows.length} ready to stage · {rows.length - importRows.length}{' '}
              skipped (missing email)
            </Text>
            <View className="gap-1.5 bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
              {importRows.slice(0, 5).map((r, i) => (
                <View key={i} className="border-t border-gray-100 dark:border-gray-700 pt-1.5 first:border-t-0 first:pt-0">
                  <Text className="text-gray-900 dark:text-gray-50 text-sm">
                    {String(r.full_name ?? '(no name)')} · {String(r.email)}
                  </Text>
                  {r.plan_name ? (
                    <Text className="text-gray-500 dark:text-gray-400 text-xs">
                      Plan: {String(r.plan_name)}
                      {r.plan_end ? ` (ends ${r.plan_end})` : ''}
                    </Text>
                  ) : null}
                </View>
              ))}
              {importRows.length > 5 ? (
                <Text className="text-gray-400 dark:text-gray-500 text-xs pt-1">
                  …and {importRows.length - 5} more.
                </Text>
              ) : null}
            </View>

            <View className="flex-row gap-2 pt-2">
              <Button variant="secondary" onPress={() => setPhase('map')}>
                Back
              </Button>
              <View className="flex-1" />
              <Button
                onPress={() => commit.mutate()}
                loading={commit.isPending}
                disabled={importRows.length === 0}>
                Import {importRows.length} members
              </Button>
            </View>
            {error ? (
              <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
            ) : null}
          </View>
        ) : null}

        {phase === 'handover' && importResult ? (
          <HandoverPanel
            gymId={membership?.gymId ?? null}
            gymName={brand.gymName}
            primaryColor={brand.primaryColor}
            slug={brand.slug}
            result={importResult}
          />
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function FieldPicker({
  value,
  onChange,
}: {
  value: TempleField | 'ignore';
  onChange: (v: TempleField | 'ignore') => void;
}) {
  // Native-feeling picker that works on web (<select>) and skips
  // native, where we ship as a chip-of-chips horizontal scroll.
  if (Platform.OS === 'web') {
    return (
      // eslint-disable-next-line jsx-a11y/no-onchange
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as TempleField | 'ignore')}
        style={{
          fontSize: 13,
          padding: '4px 8px',
          borderRadius: 8,
          border: '1px solid #D1D5DB',
          background: 'transparent',
          color: 'inherit',
        }}>
        {FIELD_OPTIONS.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  return (
    <Text className="text-gray-700 dark:text-gray-200 text-xs">
      {FIELD_OPTIONS.find((o) => o.key === value)?.label ?? '?'}
    </Text>
  );
}

function HandoverPanel({
  gymId,
  gymName,
  primaryColor,
  slug,
  result,
}: {
  gymId: string | null;
  gymName: string;
  primaryColor: string;
  slug: string | null;
  result: ImportResult;
}) {
  const queryClient = useQueryClient();
  const origin =
    Platform.OS === 'web' && typeof window !== 'undefined'
      ? window.location.origin
      : 'https://app.temple';
  const url = slug ? joinUrl(origin, slug) : null;

  const stats = useQuery({
    queryKey: ['pending-members-stats', gymId],
    enabled: !!gymId,
    refetchInterval: 8000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('pending_members_stats', {
        p_gym_id: gymId!,
      });
      if (error) throw error;
      const row = (data ?? [])[0] as
        | { pending: number; invited: number; linked: number; skipped: number; total: number }
        | undefined;
      return row ?? { pending: 0, invited: 0, linked: 0, skipped: 0, total: 0 };
    },
  });

  // Build a per-member CSV the owner can drop into Mailchimp /
  // their existing newsletter tool and merge — `email`, `name`, and
  // the bare join URL (gyms append ?utm_… themselves if they want).
  const sendFromTemple = useMutation({
    mutationFn: async () => {
      if (!gymId) throw new Error('Missing context');
      const { data, error } = await supabase
        .from('email_campaigns')
        .insert({
          gym_id: gymId,
          title: `Welcome to ${gymName}`,
          subject: `Welcome to ${gymName} — your new home for booking`,
          preheader: 'Sign in to claim your account and keep your membership.',
          design: welcomeStarter(gymName, url ?? '#', primaryColor),
          audience: { kind: 'pending_members' },
        })
        .select('id')
        .single();
      if (error) throw error;
      return (data as { id: string }).id;
    },
    onSuccess: (id) => {
      queryClient.invalidateQueries({ queryKey: ['email-campaigns'] });
      router.push(`/management/communications/${id}` as never);
    },
  });

  function downloadPerMemberCsv() {
    if (Platform.OS !== 'web' || typeof document === 'undefined' || !url) return;
    // Pull the pending rows server-side so the CSV reflects exactly
    // what's staged for this gym right now.
    supabase
      .from('pending_members')
      .select('email, full_name')
      .eq('gym_id', gymId!)
      .in('status', ['pending', 'invited'])
      .then(({ data }) => {
        const rows = data ?? [];
        const lines = ['email,name,join_url'];
        for (const r of rows) {
          const safe = (s: string) => `"${s.replace(/"/g, '""')}"`;
          lines.push(
            `${safe(String((r as { email: string }).email))},${safe(String((r as { full_name: string | null }).full_name ?? ''))},${safe(url)}`,
          );
        }
        const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${gymName.replace(/\s+/g, '-').toLowerCase()}-invite-list.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
      });
  }

  return (
    <View className="gap-4">
      <View className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 gap-1">
        <Text className="text-gray-900 dark:text-gray-50 font-semibold">
          Imported {result.inserted + result.updated} members
        </Text>
        <Text className="text-gray-500 dark:text-gray-400 text-xs">
          {result.inserted} new · {result.updated} updated · {result.skipped} skipped
          (no email)
        </Text>
      </View>

      <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3">
        <View className="gap-1">
          <Text className="text-gray-900 dark:text-gray-50 font-semibold">
            Hand the join link to your members
          </Text>
          <Text className="text-gray-500 dark:text-gray-400 text-xs">
            They sign up with the same email you imported. Their plan, tags
            and history come along automatically.
          </Text>
        </View>
        {url ? (
          <View className="flex-row items-center gap-3">
            <View className="bg-white p-2 rounded-lg border border-gray-200">
              <QRCode value={url} size={96} />
            </View>
            <View className="flex-1 gap-2">
              <View className="bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-2">
                <Text
                  className="text-gray-700 dark:text-gray-200 text-sm font-mono"
                  numberOfLines={1}>
                  {url}
                </Text>
              </View>
              <ChipButton
                label="Download per-member invite CSV"
                icon="download-outline"
                onPress={downloadPerMemberCsv}
              />
            </View>
          </View>
        ) : (
          <Text className="text-gray-500 dark:text-gray-400 text-xs">
            Set a public join slug on the Branding page first.
          </Text>
        )}
      </View>

      <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3">
        <View className="gap-1">
          <Text className="text-gray-900 dark:text-gray-50 font-semibold">
            Or, let Temple send the welcome
          </Text>
          <Text className="text-gray-500 dark:text-gray-400 text-xs">
            We pre-fill a "Welcome to {gymName}" campaign with the join
            button and open it in the editor so you can preview before send.
          </Text>
        </View>
        <Button
          variant="secondary"
          onPress={() => sendFromTemple.mutate()}
          loading={sendFromTemple.isPending}>
          Open welcome campaign
        </Button>
      </View>

      {stats.data ? (
        <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-2">
          <Text className="text-gray-900 dark:text-gray-50 font-semibold">
            Linking progress
          </Text>
          <Text className="text-gray-500 dark:text-gray-400 text-xs">
            Refreshes every few seconds — keep this page open while your
            members sign up.
          </Text>
          <View className="flex-row gap-4 pt-1">
            <Stat label="Linked" value={stats.data.linked} accent={primaryColor} />
            <Stat label="Pending" value={stats.data.pending + stats.data.invited} />
            <Stat label="Total" value={stats.data.total} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: string;
}) {
  return (
    <View className="flex-1">
      <Text className="text-gray-400 dark:text-gray-500 text-[10px] uppercase tracking-widest">
        {label}
      </Text>
      <Text
        style={accent ? { color: accent } : undefined}
        className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
        {value}
      </Text>
    </View>
  );
}

// Starter "Welcome to <gym>" block document so the campaign editor
// lands the owner on something usable. Brand-coloured CTA button
// points at the join URL.
function welcomeStarter(
  gymName: string,
  joinHref: string,
  primary: string,
): Json {
  return {
    version: 1,
    blocks: [
      {
        type: 'heading',
        text: `Welcome to ${gymName}`,
        level: 1,
        align: 'center',
        color: '#0F172A',
      },
      {
        type: 'text',
        text:
          `Hi {{first_name}},\n\nWe've moved our member portal to Temple — and your account is already set up. Sign in with the email this message arrived at, set a password, and you're done. Your plan, your tags, and your history follow you over.`,
        align: 'left',
        color: '#334155',
      },
      {
        type: 'button',
        text: 'Sign in to Temple',
        href: joinHref,
        align: 'center',
        backgroundColor: primary,
        textColor: '#FFFFFF',
        radius: 8,
      },
      {
        type: 'text',
        text: 'See you soon at the gym.',
        align: 'left',
        color: '#475569',
      },
    ],
    settings: {
      backgroundColor: '#F1F5F9',
      contentBackgroundColor: '#FFFFFF',
      contentWidth: 600,
      fontFamily:
        '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif',
    },
  } as unknown as Json;
}
