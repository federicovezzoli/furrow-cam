# Packaging resources

electron-builder's `buildResources` (`electron-builder.yml`): the app icons, which `.furrow` files also show on macOS and Windows.

- `icon.icns` (macOS), `icon.ico` (Windows, 16–256 px) and `icon.png` (Linux, 1024 px) are rendered from the web app's [`icon.svg`](../../web/src/app/icon.svg).
- The macOS icon follows Apple's grid: the artwork is 824 px wide, centred on a 1024 px canvas. The others fill their canvas, as the favicon does.

Regenerate all three whenever `icon.svg` changes.
