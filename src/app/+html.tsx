import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

// Expo Router's HTML shell for the web build. Lets us put things in <head>
// that React Native can't reach — specifically, the OS chrome colour
// (Safari notch tint, Android URL bar) that sits outside the React tree.
//
// The two theme-color metas key off the OS preference for first paint /
// pre-React rendering. After mount, src/app/_layout.tsx replaces them with a
// single tag tracking the in-app dark-mode toggle (which can override the OS
// preference via the NavModal).
//
// Hex values mirror src/lib/theme.ts (screenBg) and tailwind.config.js
// (gray-50 / gray-950). Single-sourcing is a small follow-up; not worth the
// CSS-variable pipework for two extra references right now.
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no"
        />
        {/* First paint is always light — Temple defaults to light mode
            for new visitors regardless of OS preference. The runtime
            useThemePreference effect swaps to dark for users who've
            explicitly chosen it; first-paint flash for that group is
            acceptable since they've opted in. */}
        <meta name="theme-color" content="#F1F5F9" />
        <style
          dangerouslySetInnerHTML={{
            __html: `
              html, body { margin: 0; background-color: #F1F5F9; }
            `,
          }}
        />
        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}
