import { useState } from 'react';
import { View } from 'react-native';
import { Text } from '@/components/Text';

import { Button } from '@/components/Button';
import { ChipButton } from '@/components/ChipButton';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Input } from '@/components/Input';
import { Sheet, SheetAction } from '@/components/Sheet';
import {
  addPage,
  removePage,
  renamePage,
  reslugPage,
  setPageMetaDescription,
  setPageMetaTitle,
  type SiteDocument,
} from '@/lib/site-blocks';

// Add/rename/reslug/delete every page in one place, rather than
// scattering these across the page tabs themselves — a rare, "admin"
// action compared to switching pages, which the tabs handle directly.
// Home is always first and rendered without a slug field or delete
// action: reslugPage/removePage already refuse to touch it, this just
// keeps the UI from offering a control that would silently no-op.
export function PageManagerModal({
  visible,
  document,
  gymSlug,
  onChange,
  onClose,
  onSelectPage,
}: {
  visible: boolean;
  document: SiteDocument;
  gymSlug: string;
  onChange: (next: SiteDocument) => void;
  onClose: () => void;
  onSelectPage: (pageId: string) => void;
}) {
  const [newTitle, setNewTitle] = useState('');
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  function handleAdd() {
    const title = newTitle.trim();
    if (!title) return;
    const next = addPage(document, title);
    setNewTitle('');
    onChange(next);
    onSelectPage(next.pages[next.pages.length - 1]!.id);
  }

  const pendingDeletePage = document.pages.find((p) => p.id === pendingDeleteId) ?? null;

  return (
    <>
      <Sheet
        visible={visible}
        title="Pages"
        onClose={onClose}
        dialogWidth={560}
        actions={
          <>
            <SheetAction grow>
              <Input
                label="New page"
                value={newTitle}
                onChangeText={setNewTitle}
                placeholder="e.g. Schedule"
                onSubmitEditing={handleAdd}
              />
            </SheetAction>
            <SheetAction>
              <Button variant="plain" onPress={handleAdd} disabled={!newTitle.trim()}>
                Add
              </Button>
            </SheetAction>
          </>
        }>
        <View className="gap-3 pb-1">
              {document.pages.map((p, i) => (
                <View
                  key={p.id}
                  className="gap-2 border border-line dark:border-line-dk rounded-xl p-3">
                  <View className="flex-row items-end gap-2">
                    <View className="flex-1">
                      <Input
                        label={i === 0 ? 'Title (Home page)' : 'Title'}
                        value={p.title}
                        onChangeText={(t) => onChange(renamePage(document, p.id, t))}
                      />
                    </View>
                    {i > 0 ? (
                      <ChipButton
                        label="Delete"
                        icon="trash-outline"
                        tone="red"
                        onPress={() => setPendingDeleteId(p.id)}
                      />
                    ) : null}
                  </View>
                  {i > 0 ? (
                    <View className="gap-1">
                      <Input
                        label="URL"
                        value={p.slug}
                        onChangeText={(s) => onChange(reslugPage(document, p.id, s))}
                        autoCapitalize="none"
                      />
                      <Text
                        className="text-ink-3 dark:text-ink-3-dk text-xs"
                        numberOfLines={1}>
                        /site/{gymSlug}/{p.slug}
                      </Text>
                    </View>
                  ) : null}
                  <Input
                    label="Search title"
                    value={p.metaTitle ?? ''}
                    onChangeText={(t) => onChange(setPageMetaTitle(document, p.id, t))}
                    placeholder={i === 0 ? p.title : `${p.title} — your gym name (optional)`}
                  />
                  <Input
                    label="Search description"
                    value={p.metaDescription ?? ''}
                    onChangeText={(d) => onChange(setPageMetaDescription(document, p.id, d))}
                    placeholder="One line shown in Google results (optional)"
                    multiline
                  />
                </View>
              ))}
        </View>
      </Sheet>

      <ConfirmDialog
        visible={pendingDeleteId != null}
        title={`Delete "${pendingDeletePage?.title ?? 'this page'}"?`}
        body="This removes the page and everything on it. This can't be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={() => {
          if (pendingDeleteId) onChange(removePage(document, pendingDeleteId));
          setPendingDeleteId(null);
        }}
        onCancel={() => setPendingDeleteId(null)}
      />
    </>
  );
}
