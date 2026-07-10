// Web preview: render the compiled email HTML inside a sandboxed iframe
// so its inline styles can't leak into (or read from) the app chrome.
// react-native-web renders through react-dom, so a raw <iframe> is fine
// here. The native sibling (HtmlPreview.tsx) shows a fallback.
export function HtmlPreview({
  html,
  height = 520,
}: {
  html: string;
  height?: number | string;
}) {
  return (
    <iframe
      title="Email preview"
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
