import { Ionicons } from '@expo/vector-icons';
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Text } from './Text';

import { Button } from '@/components/Button';
import { modalShape } from '@/lib/breakpoint';
import { useSheetInsets } from '@/lib/safe-area';
import { useThemeColors } from '@/lib/theme';

// One modal for the whole product: a sheet on a phone, a dialog on a
// desktop. Same title, same body, same actions, same order — only the
// container changes with the viewport.
//
// The thing this fixes is not cosmetic. Every modal in the app was a
// centred box with a dimmed backdrop at every screen size, which on a
// 390px phone is a floating card with the keyboard underneath it and
// nothing anchoring it to the bottom of the screen. Twenty-six components
// inherited that shape.
//
// Anatomy, in order:
//   - a grabber, on the sheet only, because that is the affordance that
//     says "swipe me". It is a hint, not a gesture: the sheet has no
//     swipe-to-dismiss, and adding one would need a gesture handler that
//     does not fight the body's scroll.
//   - the title on the left and a close on the right. A sheet named after
//     an object names the object ("Your bag", "Lead sources"); a picker
//     or an action names what it does ("Jump to a date", "Record
//     workout"); a confirmation asks a question and names the thing in it
//     ("Cancel Metcon?"). Two sheets must not share a title.
//   - a back chevron before the title when the sheet is showing a step
//     rather than its own body — which is how a modal that used to open
//     another modal works now: the sheet stays, its body changes
//   - a body that scrolls while the head and the foot do not
//   - a foot whose primary sits right on desktop and which is a
//     full-width pair on a phone, where both thumbs can reach it. A sheet
//     may have no foot — a nav list, a read-only list — but a sheet with
//     a primary action puts it HERE, never as the last child of the body,
//     where you have to scroll to the button that should be pinned.
//
// The breakpoint itself lives in lib/breakpoint.ts.
//
// The shell also owns the ways OUT, which is why `busy` and `dirty` are
// here rather than repeated at 33 call sites. Before them, the backdrop
// and Escape both called onClose unconditionally and exactly two modals
// guarded it — so a stray click beside a sheet holding a written day of
// programming, or twenty-four typed race splits, destroyed all of it with
// nothing asked.
// Three widths, named for what fits rather than by a number, because the
// number is a judgement about a shape and the shape is what a caller
// knows. Nine were in use before this and the gaps between them were not
// decisions — no call site moves more than 40px.
//
// Dialog only: below `md` every sheet is full width and this is ignored.
export type SheetSize = 'compact' | 'standard' | 'wide';

// Board 04's rule, enforced rather than described. Types cannot see
// through `children: ReactNode`, so this is a runtime throw — and not
// gated on __DEV__, because the test env pins that false and an
// unenforceable rule is what got us here. It is deliberately loud: on
// react-native-web a nested modal portals out and looks fine, which is
// exactly why one shipped and stayed.
const InSheet = createContext(false);

const DIALOG_WIDTH: Record<SheetSize, number> = {
  compact: 440,  // one question, a short list, a month grid
  standard: 560, // labelled fields in a single column
  wide: 660,     // a sectioned form, or a list beside a form
};

const DISCARD = {
  title: 'Discard your changes?',
  body: "You have typed something here that has not been saved. Leaving now throws it away.",
  confirmLabel: 'Discard',
  cancelLabel: 'Keep editing',
};

export function Sheet({
  visible,
  title,
  subtitle,
  onClose,
  children,
  actions,
  onBack,
  busy = false,
  dirty = false,
  discard,
  size = 'compact',
}: {
  visible: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  // Set while the sheet is showing a step: picking a movement, choosing a
  // format, editing a tag. Board 04's rule — a modal never opens another
  // modal, because two sheets stacked on a phone is two grabbers, two
  // backdrops, and the first one still scrolled behind the second. Back
  // returns to the body; close still closes the whole thing.
  onBack?: () => void;
  // The foot. Order them cancel-first: on desktop that puts the primary
  // on the right, on a phone it puts it under the dominant thumb.
  actions?: ReactNode;
  // A write is in flight. Every exit the SHELL owns goes dead — the
  // backdrop, Escape, the close X, the back chevron. The caller's foot is
  // untouched: its primary is already showing a spinner, and that is the
  // button that should still look alive. This is the half that stops a
  // double-charge, not just a lost draft.
  busy?: boolean;
  // The body holds typing that has not been written, so the shell's exits
  // ask before they take it away. Ignored while `busy` — a write in flight
  // outranks a question about a draft.
  //
  // `dirty` means TYPED, not CHOSEN. A radio moved from "Just this one" to
  // "The whole series" is not unsaved work, and prompting on it is how a
  // prompt becomes something people dismiss without reading.
  dirty?: boolean;
  discard?: Partial<typeof DISCARD>;
  size?: SheetSize;
}) {
  if (useContext(InSheet)) {
    throw new Error(
      `Sheet "${title}" is rendered inside another Sheet. A modal never ` +
        'opens another modal — give the outer sheet a step (onBack) instead, ' +
        'or close it before opening this one.',
    );
  }

  const { width, height } = useWindowDimensions();
  const insets = useSheetInsets();
  const colors = useThemeColors();
  const asDialog = modalShape(width) === 'dialog';

  // A phone sheet is bottom-anchored, so its last row sits on the home
  // indicator unless something makes room. BottomDock's floor is the
  // house idiom: honour the inset, but never leave less than a thumb's
  // worth of gap on a device that reports none.
  const bottomInset = asDialog ? 16 : 16 + Math.max(insets.bottom, 10);

  // The old fractions were a guess at "leave a bit of the page showing"
  // with no idea where the status bar was; on a notched phone the sheet
  // cleared the notch by luck. Now the fraction is only an upper bound.
  const maxHeight = asDialog
    ? Math.min(height * 0.86, height - insets.top - insets.bottom - 48)
    : Math.min(height * 0.9, height - insets.top - 12);

  // The discard question is a STEP of this sheet, not a second one. Board
  // 04's rule is not suspended because the question is the shell's own:
  // two sheets on a phone is two grabbers and two backdrops whoever put
  // them there.
  const [asking, setAsking] = useState(false);
  const [wasVisible, setWasVisible] = useState(visible);
  if (wasVisible !== visible) {
    setWasVisible(visible);
    setAsking(false);
  }
  const copy = { ...DISCARD, ...discard };

  // A one-sentence question does not want a 660px dialog.
  const dialogWidth = DIALOG_WIDTH[asking ? 'compact' : size];

  // Every step-using sheet gives its step a distinct title, so the title
  // is a free step key. Without this, opening a picker from halfway down
  // a long form opens it already scrolled.
  const scroller = useRef<ScrollView>(null);
  useEffect(() => {
    scroller.current?.scrollTo({ y: 0, animated: false });
  }, [title]);

  // The three exits the shell owns. The foot is the caller's and does not
  // come through here.
  function requestDismiss() {
    if (busy || asking) return;
    if (dirty) {
      setAsking(true);
      return;
    }
    onClose();
  }

  // While the question is up the head keeps only the title. A two-answer
  // question with a third exit whose meaning is ambiguous — does the X
  // discard or keep? — is the defect restated. While `busy` the buttons
  // stay in the tree and go disabled, so the head does not reflow.
  const head = (
    <View className="flex-row items-start gap-3 px-4 pb-3 pt-2">
      {onBack && !asking ? (
        <Pressable
          onPress={onBack}
          disabled={busy}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Back"
          accessibilityState={{ disabled: busy }}
          className={`w-[30px] h-[30px] rounded-full items-center justify-center border border-line-strong dark:border-line-strong-dk active:opacity-70 ${
            busy ? 'opacity-40' : ''
          }`}>
          <Ionicons name="chevron-back" size={15} color={colors.ink2} />
        </Pressable>
      ) : null}
      <View className="flex-1 gap-0.5">
        <Text
          accessibilityRole="header"
          className="text-ink dark:text-ink-dk text-[19px] font-bold tracking-[-0.5px]">
          {asking ? copy.title : title}
        </Text>
        {!asking && subtitle ? (
          <Text className="text-ink-3 dark:text-ink-3-dk text-[13px]">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {asking ? null : (
        <Pressable
          onPress={requestDismiss}
          disabled={busy}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Close"
          accessibilityState={{ disabled: busy }}
          className={`w-[30px] h-[30px] rounded-full items-center justify-center border border-line-strong dark:border-line-strong-dk active:opacity-70 ${
            busy ? 'opacity-40' : ''
          }`}>
          <Ionicons name="close" size={14} color={colors.ink2} />
        </Pressable>
      )}
    </View>
  );

  const footActions = asking ? (
    <>
      <SheetAction>
        <Button variant="secondary" onPress={() => setAsking(false)}>
          {copy.cancelLabel}
        </Button>
      </SheetAction>
      <SheetAction grow>
        <Button
          variant="destructive"
          onPress={() => {
            setAsking(false);
            onClose();
          }}>
          {copy.confirmLabel}
        </Button>
      </SheetAction>
    </>
  ) : (
    actions
  );

  const foot = footActions ? (
    <View
      style={{ paddingBottom: bottomInset }}
      className={`flex-row gap-2 px-4 pt-3 border-t border-line dark:border-line-dk ${
        asDialog ? 'justify-end' : ''
      }`}>
      {footActions}
    </View>
  ) : null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType={asDialog ? 'fade' : 'slide'}
      // Without these the Android modal gets its own window, inset by the
      // system bars, while useWindowDimensions still reports the whole
      // window — so maxHeight was measured against a height the sheet
      // never had. React-native-web drops both.
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={requestDismiss}>
      <View style={{ flex: 1 }}>
        {/* The dim, as a sibling BEHIND the card rather than its parent.
            It used to wrap the dialog, which is invalid — an ARIA button
            cannot own a dialog — and because react-native-web gives every
            Pressable a tabIndex, it was also the first tab stop inside
            every modal in the product: a control announced "Close" that
            is not visibly anywhere. It keeps the press, because a tap
            outside is a real affordance, and loses the role, the label and
            the tab stop, because the head's Close already is those. */}
        <Pressable
          onPress={requestDismiss}
          tabIndex={-1}
          aria-hidden
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={StyleSheet.absoluteFill}
          className="bg-black/45"
        />
        <KeyboardAvoidingView
          style={{ flex: 1, pointerEvents: 'box-none' }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View
            style={{ pointerEvents: 'box-none' }}
            className={`flex-1 ${
              asDialog ? 'items-center justify-center px-6' : 'justify-end'
            }`}>
            {/* Was a Pressable whose only job was to swallow the backdrop's
                press. With the dim behind rather than around it, there is
                nothing to swallow. */}
            <View
              accessibilityViewIsModal
              role="dialog"
              aria-modal
              accessibilityLabel={asking ? copy.title : title}
              style={
                asDialog
                  ? { width: Math.min(dialogWidth, width - 48), maxHeight }
                  : { width: '100%', maxHeight }
              }
              className={`bg-surface dark:bg-surface-dk border border-line dark:border-line-dk shadow-float ${
                asDialog ? 'rounded-[18px]' : 'rounded-t-[22px] border-b-0'
              }`}>
              {asDialog ? null : (
                <View className="items-center pt-2 pb-0.5">
                  <View className="w-9 h-1 rounded-full bg-sunken dark:bg-sunken-dk" />
                </View>
              )}
              {head}
              <InSheet.Provider value>
              <ScrollView
                ref={scroller}
                contentContainerClassName="px-4"
                contentContainerStyle={{ paddingBottom: foot ? 12 : bottomInset }}
                keyboardShouldPersistTaps="handled">
                {asking ? (
                  <Text className="text-ink-2 dark:text-ink-2-dk text-[14.5px] leading-[21px]">
                    {copy.body}
                  </Text>
                ) : (
                  children
                )}
              </ScrollView>
              </InSheet.Provider>
              {foot}
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

// A foot button that fills its half of a phone sheet and sizes to its
// label on a desktop dialog, so callers do not have to branch.
export function SheetAction({
  children,
  grow,
}: {
  children: ReactNode;
  grow?: boolean;
}) {
  const { width } = useWindowDimensions();
  const asDialog = modalShape(width) === 'dialog';
  return (
    <View className={asDialog ? '' : grow ? 'flex-[1.4]' : 'flex-1'}>
      {children}
    </View>
  );
}
