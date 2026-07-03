import { useEffect, useRef } from 'react';

import { parseFieldPath } from '@/lib/site-canvas-sync';

const CANVAS_SOURCE = 'temple-site-canvas';

type CanvasMessage =
  | { source: typeof CANVAS_SOURCE; type: 'field-input'; path: string; value: string }
  | { source: typeof CANVAS_SOURCE; type: 'field-focus'; path: string };

// Web preview: the actual rendered page HTML inside a sandboxed
// iframe — same renderer that ships to /api/site/[slug], so what an
// owner sees here is what a visitor sees.
//
// Two modes:
// - Read-only (default, `editable` unset): `sandbox="allow-same-origin"`,
//   no scripts, `srcDoc` reloads the iframe on every `html` change.
// - Editable: `sandbox="allow-same-origin allow-scripts"` — required
//   for the in-frame bridge script (site-render.ts's
//   CANVAS_BRIDGE_SCRIPT) to report contentEditable keystrokes back
//   here. The iframe becomes uncontrolled and only ever reloads on
//   `syncKey` changing (a debounced counter bumped by non-canvas
//   edits) — never on `html` itself, so a canvas keystroke can never
//   trigger a reload and lose cursor/focus mid-word.
export function SiteHtmlPreview({
  html,
  height = 640,
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
    return <iframe title="Site preview" srcDoc={html} sandbox="allow-same-origin" style={style} />;
  }

  return (
    <iframe
      ref={iframeRef}
      title="Site preview"
      sandbox="allow-same-origin allow-scripts"
      style={style}
    />
  );
}
