// The QR renderer, stubbed for the test runner.
//
// react-native-qrcode-svg ships untranspiled JSX inside a `.js` file, so
// vite refuses to parse it — the same shape of problem as react-native-svg
// and with the same answer. It draws through react-native-svg anyway, and
// what a render test can usefully assert about a QR is the value it was
// asked to encode, not the modules it drew.
export default function QRCode({ value, size }: { value: string; size?: number }) {
  return <svg data-testid="qrcode" data-value={value} width={size} height={size} />;
}
