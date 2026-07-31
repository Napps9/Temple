// Putting a file in somebody's hands, on web and on a phone.
//
// Lifted out of csv.ts when the training-history export needed the same
// mechanism with a different mime type. Two callers, one path — a second
// copy of the blob/share dance is how one of them quietly stops working on
// iOS and nobody notices for a year.

export async function downloadFile(
  filename: string,
  contents: string,
  mimeType: string,
): Promise<void> {
  // Web detection without importing react-native at module scope — keeps
  // this importable by Vitest without a react-native bundler.
  const isWeb =
    typeof document !== 'undefined' &&
    typeof URL !== 'undefined' &&
    'createObjectURL' in URL;
  if (isWeb) {
    const blob = new Blob([contents], { type: `${mimeType};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 0);
    return;
  }
  const [fs, sharing] = await Promise.all([
    import('expo-file-system'),
    import('expo-sharing'),
  ]);
  const file = new fs.File(fs.Paths.cache, filename);
  file.write(contents);
  if (await sharing.isAvailableAsync()) {
    await sharing.shareAsync(file.uri, { mimeType, dialogTitle: filename });
  }
}
