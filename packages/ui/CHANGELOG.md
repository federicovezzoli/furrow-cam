# @furrow/ui

## 0.8.5

### Patch Changes

- A project can now hold drawings and a 3D model together, so a relief and the profile that cuts it out live in one project. The ribbon gets a button to import a model at any time. ([#509](https://github.com/federicovezzoli/furrow-cam/pull/509))
- Projects now remember which of your machines they use, and offer to update their copy when you open them after editing that machine. ([#520](https://github.com/federicovezzoli/furrow-cam/pull/520))
- *Terrain from a map* can download the terrain as a closed STL file, for 3D printing or another CAM, also in a project that already has its model or on a server that can't store 3D models. ([#518](https://github.com/federicovezzoli/furrow-cam/pull/518))
- Make a relief model from a map with *Terrain*: draw a rectangle, circle, ellipse or freehand area, choose the model's size, exaggeration and base, and generate it. The terrain becomes the project's model at the size chosen, centred on the stock, and machines like any imported STL. ([#513](https://github.com/federicovezzoli/furrow-cam/pull/513))
- *Terrain from a map* can find a place: type its name for suggestions, or enter coordinates or paste a Google Maps or OpenStreetMap link, which never leave your device. The model is named after the place picked. ([#516](https://github.com/federicovezzoli/furrow-cam/pull/516))
- *Terrain from a map* now works in two steps: pick the area on the map, then see a 3D preview of the relief while choosing its size, exaggeration and base. The map opens straight away and can be dragged with the new *Move* tool, the chosen shape is easy to see, and an area can also be a square. ([#523](https://github.com/federicovezzoli/furrow-cam/pull/523))
- Updated dependencies: @furrow/document@0.22.0, @furrow/cam-core@0.20.0

## 0.8.4

### Patch Changes

- A drawing's or model's properties now have a *Center on stock* button that moves it to the middle of the stock in X and Y, whatever the zero point; a model keeps its height. ([#498](https://github.com/federicovezzoli/furrow-cam/pull/498))
  
  The properties panes keep their header in view while scrolling, Remove buttons are red, and the model pane no longer scrolls sideways in longer languages.
- The desktop start screen no longer lists files that failed to open, and any recent file can now be removed from the list. ([#497](https://github.com/federicovezzoli/furrow-cam/pull/497))

## 0.8.3

### Patch Changes

- Place drill holes by clicking in the viewport, with the cursor snapping to corners, centres, segment midpoints and edges, so a hole no longer needs a point in the drawing. ([#483](https://github.com/federicovezzoli/furrow-cam/pull/483))
- Updated dependencies: @furrow/document@0.21.0, @furrow/cam-core@0.19.0

## 0.8.2

### Patch Changes

- Two-sided projects now show the parting plane in the 3D view of the viewport and the simulator, so you can see where the two sides meet. A button next to the toolpath toggle shows or hides it. ([#474](https://github.com/federicovezzoli/furrow-cam/pull/474))

## 0.8.1

### Patch Changes

- Inside and outside profiles can overcut their sharp inside corners (dogbones), so a square tenon or insert fits without filing. Turn on *Corner overcuts*, choose the sharpest angle that gets one, and with *Edit overcuts* click one to leave that corner out. ([#462](https://github.com/federicovezzoli/furrow-cam/pull/462))
- On Windows and Linux the desktop app now downloads and installs a new version itself when you choose Download and Install, then restarts into it. On macOS it still links to the release page. ([#461](https://github.com/federicovezzoli/furrow-cam/pull/461))
- Updated dependencies: @furrow/document@0.20.0, @furrow/cam-core@0.18.0

## 0.8.0

### Minor Changes

- A new Third-party licences page, linked from the web footer and the desktop Help menu, lists OpenCascade and the bundled fonts with their licences and shipped licence texts, which open offline in the desktop app. ([#455](https://github.com/federicovezzoli/furrow-cam/pull/455))

### Patch Changes

- Place start points on profiles and engravings in the viewport: a closed contour starts its cut there, and an open path is cut from that end on every pass instead of back and forth. ([#456](https://github.com/federicovezzoli/furrow-cam/pull/456))
- Updated dependencies: @furrow/document@0.19.0, @furrow/cam-core@0.17.0

## 0.7.0

### Minor Changes

- Machines can hold their X/Y and Z accelerations, and with them the machining time estimate accounts for speeding up, slowing down and corners, so relief finishing and other jobs with many short moves are no longer badly underestimated. Without them, the estimate says it is a lower bound. ([#440](https://github.com/federicovezzoli/furrow-cam/pull/440))

### Patch Changes

- STEP files (`.step`, `.stp`) from CAD programs such as Fusion, FreeCAD or Onshape can now be imported as 3D models, in their true size whatever unit they were drawn in, and machined like STL reliefs. ([#446](https://github.com/federicovezzoli/furrow-cam/pull/446))
- Updated dependencies: @furrow/document@0.18.0, @furrow/cam-core@0.16.1

## 0.6.0

### Minor Changes

- Tapered ball-nose bits are a new bit type, described by their angle per side, tip diameter and flute length: 3D finishing and engraving cut with their real shape, ball tip and cone, so steep walls are no longer gouged in the preview. Projects that use them need this release to open. ([#430](https://github.com/federicovezzoli/furrow-cam/pull/430))
- The workspace has a ribbon under the top bar: import a drawing or add text, add operations and open versions from one place. Buttons that can't act yet say why in a tooltip. ([#433](https://github.com/federicovezzoli/furrow-cam/pull/433))

### Patch Changes

- In Italian, the V-carve operation is now called "V-carve", the term CNC users already know, instead of "Intaglio a V". ([#433](https://github.com/federicovezzoli/furrow-cam/pull/433))
- The machine form now explains that the max feeds should match your controller's maximum rates ($110–$112, in mm/min), that they cap the bit's cutting feeds, and that the time estimate uses them for travel moves. ([#431](https://github.com/federicovezzoli/furrow-cam/pull/431))
- A model can now sit below the stock top: set *Top below stock* in its properties to machine the whole relief deeper without stretching it, for example to recover a part or to leave a raised border. ([#436](https://github.com/federicovezzoli/furrow-cam/pull/436))
- Operations that cut where a locating pin goes now warn, so the end mill doesn't run into the pins once the stock is turned over. ([#414](https://github.com/federicovezzoli/furrow-cam/pull/414))
- Updated dependencies: @furrow/document@0.17.0, @furrow/cam-core@0.16.0

## 0.5.0

### Minor Changes

- Furrow CAM is now also available in Spanish, Dutch, Portuguese, Greek, Turkish, Chinese and Japanese. It picks the language from your browser or system, or you can choose one with the language button. ([#421](https://github.com/federicovezzoli/furrow-cam/pull/421))

### Patch Changes

- The operations pane shows about how long each operation takes to cut on the project's machine, and the total for the job (per side in a two-sided project). Exported G-code states the estimate in its header. ([#422](https://github.com/federicovezzoli/furrow-cam/pull/422))

## 0.4.0

### Minor Changes

- Two-sided projects can hold the part with tabs that the bottom side leaves at the parting depth, spread round each model and dragged along its outline. Each side now also cuts all of the model it can see, so models that aren't widest at the parting depth are cut without a skirt. ([#392](https://github.com/federicovezzoli/furrow-cam/pull/392))

### Patch Changes

- A drawing's *Angle* field now shows how far the drawing is turned, follows the 90° buttons and mirroring, and turns the drawing to the angle you type; 0 brings it back to how it was imported. ([#406](https://github.com/federicovezzoli/furrow-cam/pull/406))
- Two-sided projects without a spoilboard to drill into can line the turned-over stock up by a corner pushed into a fence corner instead of on pins. The G-code says which corner to push into the fences and the stock size the two sides depend on, so it can be measured first. ([#391](https://github.com/federicovezzoli/furrow-cam/pull/391))
- 3D finishing can now cover a margin around the model or the whole stock, like roughing, so the floor of a roughed margin is finished down to the model's bottom and the stock top beyond it is left alone. ([#402](https://github.com/federicovezzoli/furrow-cam/pull/402))
- Two-sided projects can have locating pins: set their diameter, their positions along the flip axis and whether their holes go through into the spoilboard or only into the stock, then drill them on the top side. The viewport shows the pins on both sides, and the bottom side's G-code says to turn the stock over onto them. ([#390](https://github.com/federicovezzoli/furrow-cam/pull/390))
- The operations pane's selection hint now says "Shift+click to add more", matching the onboarding tour. ([#393](https://github.com/federicovezzoli/furrow-cam/pull/393))
- Projects can be made two-sided in the project properties, choosing the axis the stock is turned over about and the parting depth. A Top / Bottom switch in the viewport shows each side, and the bottom side's simulation starts from the stock the top side leaves, turned over. Operations show their side, and new ones go on the side in view. ([#383](https://github.com/federicovezzoli/furrow-cam/pull/383))
- Updated dependencies: @furrow/document@0.16.0, @furrow/cam-core@0.15.0

## 0.3.5

### Patch Changes

- Profiles, pockets, drilling, engraving and V-carving can cut the bottom side of a two-sided project, on the drawing as seen from below, and export with the bottom side's G-code. ([#380](https://github.com/federicovezzoli/furrow-cam/pull/380))
- *Convert to drawing* turns a text item into a plain drawing that keeps its letters and the operations that machine them, but can no longer be edited as text. ([#384](https://github.com/federicovezzoli/furrow-cam/pull/384))
- Upload your own TTF, OTF or WOFF font into a project from the text panel, marking it single-stroke for engraving if it is, and use it for any text in the project. ([#389](https://github.com/federicovezzoli/furrow-cam/pull/389))
- Updated dependencies: @furrow/cam-core@0.14.0, @furrow/document@0.15.0

## 0.3.4

### Patch Changes

- A two-sided project exports one G-code file per side, such as `Owl-top.gcode` and `Owl-bottom.gcode`, and each file's header says when to turn the stock over and how to zero it. ([#378](https://github.com/federicovezzoli/furrow-cam/pull/378))
- Updated dependencies: @furrow/cam-core@0.13.0, @furrow/document@0.14.0

## 0.3.3

### Patch Changes

- The app's header shows the Furrow CAM logo next to its name, as furrow.cam does. ([`cb8445f`](https://github.com/federicovezzoli/furrow-cam/commit/cb8445fb1c3da097e01cfd06b2d55f446180ba10))

## 0.3.2

### Patch Changes

- Furrow CAM has the logo and colours of furrow.cam: an F as a round end mill would carve it, for the favicons, the installable web app and the desktop app icon, and warm paper greys with an orange focus ring throughout the app. Panels floating over the 3D view blur what lies behind them. ([`033a756`](https://github.com/federicovezzoli/furrow-cam/commit/033a756b90c6014de4ab969143c415999782d157))
- The workspace sidebar now shows Operations and Properties as two tabs, so the project's properties are always one click away. Importing another drawing and the project's versions moved to labelled buttons in the top bar. ([`242d067`](https://github.com/federicovezzoli/furrow-cam/commit/242d0679471253336e346841a3d8ec852498ed59))

## 0.3.1

### Patch Changes

- Operations are reordered by dragging the handle at the start of their row, or with ↑ and ↓ while the handle is focused, instead of with up and down arrow buttons. ([#343](https://github.com/federicovezzoli/furrow-cam/pull/343))
- The Versions pane now says why when the list of versions can't be loaded, instead of showing "Loading versions…" forever. ([#341](https://github.com/federicovezzoli/furrow-cam/pull/341))
- Updated dependencies: @furrow/document@0.13.1, @furrow/cam-core@0.12.1

## 0.3.0

### Minor Changes

- Errors, confirmations and renames now open in an in-app dialog that matches the theme, instead of the browser's own alert, confirm and prompt boxes. ([#338](https://github.com/federicovezzoli/furrow-cam/pull/338))

### Patch Changes

- Error messages from saving, importing and managing projects, tools, machines and 3D models are now shown in the language the page is displayed in. ([#331](https://github.com/federicovezzoli/furrow-cam/pull/331))
- You can duplicate a drawing from its properties. The copy lands 10 mm to its right and is selected, ready to move; it is machined by the same operations, with the same profile tabs. ([#336](https://github.com/federicovezzoli/furrow-cam/pull/336))
- The step-over is now set on each pocket, drill, V-carve flat bottom and 3D roughing operation instead of on the bit, so operations with the same bit can use different step-overs. Existing projects keep the step-over their bits had. ([#335](https://github.com/federicovezzoli/furrow-cam/pull/335))
- While toolpaths compute, a toast in the viewport's bottom left corner shows the operation computing now, its progress and how many are done, with a button to cancel it. The operation's properties also show its progress as a percentage. ([#337](https://github.com/federicovezzoli/furrow-cam/pull/337))
- With a touch-off pad, the tool-change field now always shows the block that runs at each tool change, derived from the machine's unless you edit it, and **Reset** goes back to that block. Exported programs follow it: a machine tool change that moves now has its move put on the pad, and the default pause no longer names the bit, since the comment just before it already does. ([#320](https://github.com/federicovezzoli/furrow-cam/pull/320))
- Updated dependencies: @furrow/document@0.13.0, @furrow/cam-core@0.12.0

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
