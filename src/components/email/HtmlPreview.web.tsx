import { useEffect, useRef } from 'react';

import { parseFieldPath } from '@/lib/email/canvas-sync';

const CANVAS_SOURCE = 'temple-email-canvas';

type CanvasMessage =
  | { source: typeof CANVAS_SOURCE; type: 'field-input'; path: string; value: string }
  | { source: typeof CANVAS_SOURCE; type: 'field-focus'; path: string };

// Web preview: render the compiled email HTML inside a sandboxed iframe
// so its inline styles can't leak into (or read from) the app chrome.
// react-native-web renders through react-dom, so a raw <iframe> is fine
// here. The native sibling (HtmlPreview.tsx) shows a fallback.
//
// Two modes:
// - Read-only (default, `editable` unset): `sandbox="allow-same-origin"`,
//   no scripts, `srcDoc` reloads the iframe on every `html` change.
// - Editable: `sandbox="allow-same-origin allow-scripts"` — required
//   for the in-frame bridge script (render.ts's CANVAS_BRIDGE_SCRIPT) to
//   report contentEditable keystrokes back here. The iframe becomes
//   uncontrolled and only ever reloads on `syncKey` changing (a
//   debounced counter bumped by non-canvas edits) — never on `html`
//   itself, so a canvas keystroke can never trigger a reload and lose
//   cursor/focus mid-word.
export function HtmlPreview({
  html,
  height = 520,
  editable = false,
  syncKey,
  onFieldChange,
  selectedBlockId,
  onCanvasSelect,
}: {
  html: string;
  height?: number | string;
  editable?: boolean;
  syncKey?: number;
  onFieldChange?: (path: string, value: string) => void;
  selectedBlockId?: string | null;
  onCanvasSelect?: (blockId: string | null) => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!editable) return;
    const iframe = iframeRef.current;
    if (!iframe) return;
    iframe.srcdoc = html;
    // Deliberately keyed on syncKey, not html — see the mode note above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editable, syncKey]);

  useEffect(() => {
    if (!editable) return;
    function handleMessage(e: MessageEvent) {
      if (e.source !== iframeRef.current?.contentWindow) return;
      const msg = e.data as CanvasMessage | undefined;
      if (!msg || msg.source !== CANVAS_SOURCE) return;
      if (msg.type === 'field-input') {
        onFieldChange?.(msg.path, msg.value);
      } else if (msg.type === 'field-focus') {
        const parsed = parseFieldPath(msg.path);
        if (parsed) onCanvasSelect?.(parsed.blockId);
      }
    }
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [editable, onFieldChange, onCanvasSelect]);

  useEffect(() => {
    if (!editable) return;
    iframeRef.current?.contentWindow?.postMessage(
      { type: 'select-block', blockId: selectedBlockId ?? null },
      '*',
    );
  }, [editable, selectedBlockId]);

  const style = {
    width: '100%',
    height,
    border: '1px solid #E2E8F0',
    borderRadius: 12,
    background: '#FFFFFF',
  } as const;

  if (!editable) {
    return <iframe title="Email preview" srcDoc={html} sandbox="allow-same-origin" style={style} />;
  }

  return (
    <iframe
      ref={iframeRef}
      title="Email preview"
      sandbox="allow-same-origin allow-scripts"
      style={style}
    />
  );
}
