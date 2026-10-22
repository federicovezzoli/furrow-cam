# @furrow/ui

## 0.2.1

### Patch Changes

- Updated dependencies: @furrow/cam-core@0.11.0, @furrow/document@0.12.0

## 0.2.0

### Minor Changes

- Toolpath and import warnings, file errors, export messages and form validation now appear in English, Italian, French or German. ([#305](https://github.com/federicovezzoli/furrow-cam/pull/305))
- Furrow CAM starts in your browser's or system's language when it's English, Italian, French or German, and a new language button next to the theme toggle lets you pick another. Only a few labels are translated so far; the rest follows in upcoming releases. ([#301](https://github.com/federicovezzoli/furrow-cam/pull/301))
- The CAM workspace, including its operations, bit and machine forms, machine presets, simulator and guided tour, now appears in English, Italian, French or German. In Italian, French and German, number fields also accept a comma as the decimal point. ([#306](https://github.com/federicovezzoli/furrow-cam/pull/306))

### Patch Changes

- Export now reads back the machine's custom G-code blocks and warns, with the line number, when one moves the tool into material or below the stock bottom, or when it can't be followed (e.g. `G53`) and the rest of the program isn't checked. ([#291](https://github.com/federicovezzoli/furrow-cam/pull/291))
- The web app's pages, forms, messages and errors now appear in English, Italian, French or German, and dates and numbers follow the chosen language. The privacy policy stays in English, with a note saying so. ([#304](https://github.com/federicovezzoli/furrow-cam/pull/304))
- Updated dependencies: @furrow/document@0.11.0, @furrow/cam-core@0.10.0

## 0.1.6

### Patch Changes

- Updated dependencies: @furrow/document@0.10.0, @furrow/cam-core@0.9.0

## 0.1.5

### Patch Changes

- Updated dependencies: @furrow/document@0.9.0, @furrow/cam-core@0.8.4

## 0.1.4

### Patch Changes

- Updated dependencies: @furrow/cam-core@0.8.3

## 0.1.3

### Patch Changes

- Updated dependencies: @furrow/document@0.8.0, @furrow/cam-core@0.8.2

## 0.1.2

### Patch Changes

- Updated dependencies: @furrow/document@0.7.1, @furrow/cam-core@0.8.1

## 0.1.1

### Patch Changes

- A desktop app for macOS, Windows and Linux that works offline with no account: projects are saved as `.furrow` files with their versions, unsaved changes are offered back after a crash, and the bits library and machines are kept on the computer. ([#195](https://github.com/federicovezzoli/furrow-cam/pull/195))
- Updated dependencies: @furrow/document@0.7.0, @furrow/cam-core@0.8.0
