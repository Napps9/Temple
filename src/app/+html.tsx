import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

// Expo Router's HTML shell for the web build. Lets us put things in <head>
// that React Native can't reach — specifically, the OS chrome colour
// (Safari notch tint, Android URL bar) that sits outside the React tree.
//
// The theme-color meta and the html background are the light first paint.
// After mount, src/app/_layout.tsx keeps both, and the document's
// color-scheme, tracking the in-app theme — Safari paints the status-bar
// strip from whichever of them it decides to use, and a dark page over a
// light html background showed up as a white bar above the app.
//
// Hex values mirror src/lib/theme.ts (screenBg) and tailwind.config.js
// (the ramp's `ground`). Single-sourcing is a small follow-up; not worth
// the CSS-variable pipework for two extra references right now.
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        {/* viewport-fit=cover lets the page run under the iPhone status
            bar so the app's own ground paints there; the layouts pay the
            inset back through react-native-safe-area-context. */}
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover"
        />
        {/* First paint is always light — Temple defaults to light mode
            for new visitors regardless of OS preference. The runtime
            useThemePreference effect swaps to dark for users who've
            explicitly chosen it; first-paint flash for that group is
            acceptable since they've opted in. */}
        <meta name="theme-color" content="#F7F7F8" />
        {/* Temple's PWA identity, static since gyms no longer rebrand the
            app. This used to be a data-URL manifest written at runtime
            from the gym's logo and colour. */}
        <link rel="manifest" href="/manifest.json" />
        <style
          dangerouslySetInnerHTML={{
            __html: `
              html, body { margin: 0; background-color: #F7F7F8; }
            `,
          }}
        />
        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}
