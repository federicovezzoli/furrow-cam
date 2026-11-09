# Packaging resources

electron-builder's `buildResources` (`electron-builder.yml`): the app icons, which `.furrow` files also show on macOS and Windows. All of them are drawn from the web app's [`icon.svg`](../../web/src/app/icon.svg).

- `icon.icon` (macOS) is an Icon Composer icon: `icon.json` gives the background colour (the dark square of `icon.svg`) and `Assets/glyph.svg` is the rest of `icon.svg` on a 1024 px canvas. macOS 26 draws it in the system's rounded square; older macOS versions show an `.icns` that electron-builder renders from it while packaging. Compiling it needs Xcode 26 or newer (`actool`), so a macOS build without Xcode fails; CI builds on a `macos-26` runner. Open it in Icon Composer to change it, or edit the two files by hand.
- `icon.ico` (Windows, 16–256 px) and `icon.png` (Linux, 1024 px) fill their canvas, as the favicon does.

Regenerate all of them whenever `icon.svg` changes.
