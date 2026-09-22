import { useEffect } from 'react';
import { Platform } from 'react-native';

// Cmd/Ctrl+Z / Shift+Z / Ctrl+Y drive the document history while the
// builder is open. Skip when the caret is in a form field so the browser's
// native text undo still works there; the canvas is an iframe, so its own
// keystrokes never reach this listener.
export function useHistoryKeys(active: boolean, undo: () => void, redo: () => void) {
  useEffect(() => {
    if (Platform.OS !== 'web' || !active) return;
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      if (key !== 'z' && key !== 'y') return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (key === 'y' || (key === 'z' && e.shiftKey)) {
        e.preventDefault();
        redo();
      } else if (key === 'z') {
        e.preventDefault();
        undo();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, undo, redo]);
}
