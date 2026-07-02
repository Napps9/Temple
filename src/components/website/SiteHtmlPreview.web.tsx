// Web preview: the actual rendered page HTML inside a sandboxed
// iframe — same renderer that ships to /api/site/[slug], so what an
// owner sees here is what a visitor sees. No allow-scripts: the
// contact block's submit handler won't fire inside this preview, only
// on the real published page — this pane is for visual review, not a
// functional rehearsal.
export function SiteHtmlPreview({ html, height = 640 }: { html: string; height?: number }) {
  return (
    <iframe
      title="Site preview"
      srcDoc={html}
      sandbox="allow-same-origin"
      style={{
        width: '100%',
        height,
        border: '1px solid #E2E8F0',
        borderRadius: 12,
        background: '#FFFFFF',
      }}
    />
  );
}
