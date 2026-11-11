# @furrow/workspace

## 0.26.0

### Minor Changes

- A profile's start point can have a plunge point: right after placing it on a closed path, click beside the part or on a pre-drilled hole. The tool then goes up and down only there and feeds straight to the start, so T-slot and dovetail cutters can cut profiles. Plunge points can't be used together with holding tabs. ([#550](https://github.com/federicovezzoli/furrow-cam/pull/550))
- The Operations tab now shows the objects below the operations, so both are in view at once; drag the line between them to resize. ([#552](https://github.com/federicovezzoli/furrow-cam/pull/552))

### Patch Changes

- AI assistants can now make a terrain through the MCP server: give an area around coordinates or a map link, and the relief becomes the project's model, as with *Terrain from a map* in the app. This tool downloads only the area's elevation tiles from Mapterhorn; every other tool stays offline. ([#548](https://github.com/federicovezzoli/furrow-cam/pull/548))
- Updated dependencies: @furrow/cam-core@0.22.0, @furrow/document@0.24.0, @furrow/ui@0.8.9, @furrow/post@0.15.7

## 0.25.0

### Minor Changes

- Drawings, shapes and models can be hidden or locked, and the project remembers it. A hidden object isn't drawn or cut, and an operation that cuts one turns off until it is shown again; a locked one stays in view but can't be picked or moved. ([#542](https://github.com/federicovezzoli/furrow-cam/pull/542))
- A new Objects tab lists every drawing, its shapes and paths, and the 3D model. Select them from the list or with the keyboard, see what the selected operation cuts, and hide or lock each one with its eye and lock. ([#543](https://github.com/federicovezzoli/furrow-cam/pull/543))
- A click in the top view now selects a whole drawing, and Shift+click adds more. Double click a drawing to select its paths one by one (Esc leaves it), or Alt+click to pick a single path. ([#538](https://github.com/federicovezzoli/furrow-cam/pull/538))
- Drawings and their paths can be selected in the 3D view too, as in the top view. Esc steps back: it stops picking the zero or editing, leaves a drawing you entered, then clears the selection. ([#545](https://github.com/federicovezzoli/furrow-cam/pull/545))

### Patch Changes

- Updated dependencies: @furrow/document@0.23.0, @furrow/cam-core@0.21.0, @furrow/post@0.15.6, @furrow/ui@0.8.8

## 0.24.2

### Patch Changes

- Updated dependencies: @furrow/ui@0.8.7

## 0.24.1

### Patch Changes

- The MCP server can make a project two-sided and set its flip axis, parting depth, line-up (locating pins or a fence corner) and holding tabs, so an AI assistant can plan a two-sided job from scratch. A list that is too short now says how many items it needs, not how many characters. ([#530](https://github.com/federicovezzoli/furrow-cam/pull/530))
- In *Terrain from a map* the map is dragged until you pick a shape, a drawn area can be moved by dragging it, and the 3D preview shows the relief in much finer detail. The terrain no longer adds its outline as a drawing. ([#527](https://github.com/federicovezzoli/furrow-cam/pull/527))
- Updated dependencies: @furrow/document@0.22.1, @furrow/ui@0.8.6, @furrow/cam-core@0.20.1, @furrow/post@0.15.5

## 0.24.0

### Minor Changes

- A project can now hold drawings and a 3D model together, so a relief and the profile that cuts it out live in one project. The ribbon gets a button to import a model at any time. ([#509](https://github.com/federicovezzoli/furrow-cam/pull/509))
- Projects now remember which of your machines they use, and offer to update their copy when you open them after editing that machine. ([#520](https://github.com/federicovezzoli/furrow-cam/pull/520))
- *Terrain from a map* can download the terrain as a closed STL file, for 3D printing or another CAM, also in a project that already has its model or on a server that can't store 3D models. ([#518](https://github.com/federicovezzoli/furrow-cam/pull/518))
- Make a relief model from a map with *Terrain*: draw a rectangle, circle, ellipse or freehand area, choose the model's size, exaggeration and base, and generate it. The terrain becomes the project's model at the size chosen, centred on the stock, and machines like any imported STL. ([#513](https://github.com/federicovezzoli/furrow-cam/pull/513))
- A terrain from a map comes with its area's outline as a drawing around the model, so a profile operation can cut the piece out. ([#517](https://github.com/federicovezzoli/furrow-cam/pull/517))
- *Terrain from a map* can find a place: type its name for suggestions, or enter coordinates or paste a Google Maps or OpenStreetMap link, which never leave your device. The model is named after the place picked. ([#516](https://github.com/federicovezzoli/furrow-cam/pull/516))
- *Terrain from a map* now works in two steps: pick the area on the map, then see a 3D preview of the relief while choosing its size, exaggeration and base. The map opens straight away and can be dragged with the new *Move* tool, the chosen shape is easy to see, and an area can also be a square. ([#523](https://github.com/federicovezzoli/furrow-cam/pull/523))

### Patch Changes

- Updated dependencies: @furrow/ui@0.8.5, @furrow/document@0.22.0, @furrow/cam-core@0.20.0, @furrow/post@0.15.4

## 0.23.0

### Minor Changes

- A drawing's or model's properties now have a *Center on stock* button that moves it to the middle of the stock in X and Y, whatever the zero point; a model keeps its height. ([#498](https://github.com/federicovezzoli/furrow-cam/pull/498))
  
  The properties panes keep their header in view while scrolling, Remove buttons are red, and the model pane no longer scrolls sideways in longer languages.

### Patch Changes

- Updated dependencies: @furrow/ui@0.8.4

## 0.22.0

### Minor Changes

- Place drill holes by clicking in the viewport, with the cursor snapping to corners, centres, segment midpoints and edges, so a hole no longer needs a point in the drawing. ([#483](https://github.com/federicovezzoli/furrow-cam/pull/483))

### Patch Changes

- The parting plane of a two-sided project is now drawn solid in the 3D view, so it is easy to see where the two sides meet; hide it from the viewport toolbar to see what lies beyond it. ([`7b75569`](https://github.com/federicovezzoli/furrow-cam/commit/7b75569262c0d9c2c3ed86f0cb3873b9a5aad7b1))
- Updated dependencies: @furrow/document@0.21.0, @furrow/cam-core@0.19.0, @furrow/ui@0.8.3, @furrow/post@0.15.3

## 0.21.2

### Patch Changes

- The parting plane of a two-sided project is now drawn solid in the 3D view, so it is easy to see where the two sides meet; hide it from the viewport toolbar to see what lies beyond it. ([`7b75569`](https://github.com/federicovezzoli/furrow-cam/commit/7b75569262c0d9c2c3ed86f0cb3873b9a5aad7b1))

## 0.21.1

### Patch Changes

- The machine's post-processor is now labelled "GRBL / grblHAL / FluidNC", since its G-code runs unchanged on all three. ([`f4f7fc7`](https://github.com/federicovezzoli/furrow-cam/commit/f4f7fc73c5fe993192c168102be8a9f817e9f743))

## 0.21.0

### Minor Changes

- Two-sided projects now show the parting plane in the 3D view of the viewport and the simulator, so you can see where the two sides meet. A button next to the toolpath toggle shows or hides it. ([#474](https://github.com/federicovezzoli/furrow-cam/pull/474))

### Patch Changes

- Updated dependencies: @furrow/ui@0.8.2

## 0.20.0

### Minor Changes

- Inside and outside profiles can overcut their sharp inside corners (dogbones), so a square tenon or insert fits without filing. Turn on *Corner overcuts*, choose the sharpest angle that gets one, and with *Edit overcuts* click one to leave that corner out. ([#462](https://github.com/federicovezzoli/furrow-cam/pull/462))

### Patch Changes

- Updated dependencies: @furrow/document@0.20.0, @furrow/cam-core@0.18.0, @furrow/ui@0.8.1, @furrow/post@0.15.2

## 0.19.0

### Minor Changes

- Place start points on profiles and engravings in the viewport: a closed contour starts its cut there, and an open path is cut from that end on every pass instead of back and forth. ([#456](https://github.com/federicovezzoli/furrow-cam/pull/456))
- A new Third-party licences page, linked from the web footer and the desktop Help menu, lists OpenCascade and the bundled fonts with their licences and shipped licence texts, which open offline in the desktop app. ([#455](https://github.com/federicovezzoli/furrow-cam/pull/455))

### Patch Changes

- The simulator's Export G-code button now sits at the bottom left, at the start of the playback timeline, as it does in the workspace. ([`ed2386e`](https://github.com/federicovezzoli/furrow-cam/commit/ed2386e1f6acf526b2f730e8bad3b8d77c0b2f5c))
- Updated dependencies: @furrow/document@0.19.0, @furrow/cam-core@0.17.0, @furrow/ui@0.8.0, @furrow/post@0.15.1

## 0.18.0

### Minor Changes

- Exported G-code files are named after the project, the version you last saved or restored (until you change the project) and the date, e.g. `cutting-board-final-2026-11-01-top.gcode`, so exports no longer collide and are easy to tell apart on the machine. ([#452](https://github.com/federicovezzoli/furrow-cam/pull/452))
- Machines can hold their X/Y and Z accelerations, and with them the machining time estimate accounts for speeding up, slowing down and corners, so relief finishing and other jobs with many short moves are no longer badly underestimated. Without them, the estimate says it is a lower bound. ([#440](https://github.com/federicovezzoli/furrow-cam/pull/440))
- The simulator page has an Export G-code button, so you can download the program right after checking it. ([#451](https://github.com/federicovezzoli/furrow-cam/pull/451))
- STEP files (`.step`, `.stp`) from CAD programs such as Fusion, FreeCAD or Onshape can now be imported as 3D models, in their true size whatever unit they were drawn in, and machined like STL reliefs. ([#446](https://github.com/federicovezzoli/furrow-cam/pull/446))

### Patch Changes

- The model panel now shows "Top below stock" in the Position section, next to X and Y, since it moves the model rather than resizing it. ([#450](https://github.com/federicovezzoli/furrow-cam/pull/450))
- Updated dependencies: @furrow/post@0.15.0, @furrow/document@0.18.0, @furrow/ui@0.7.0, @furrow/cam-core@0.16.1

## 0.17.0

### Minor Changes

- A model can now sit below the stock top: set *Top below stock* in its properties to machine the whole relief deeper without stretching it, for example to recover a part or to leave a raised border. ([#436](https://github.com/federicovezzoli/furrow-cam/pull/436))
- Tapered ball-nose bits are a new bit type, described by their angle per side, tip diameter and flute length: 3D finishing and engraving cut with their real shape, ball tip and cone, so steep walls are no longer gouged in the preview. Projects that use them need this release to open. ([#430](https://github.com/federicovezzoli/furrow-cam/pull/430))
- The workspace has a ribbon under the top bar: import a drawing or add text, add operations and open versions from one place. Buttons that can't act yet say why in a tooltip. ([#433](https://github.com/federicovezzoli/furrow-cam/pull/433))

### Patch Changes

- The machine form now explains that the max feeds should match your controller's maximum rates ($110–$112, in mm/min), that they cap the bit's cutting feeds, and that the time estimate uses them for travel moves. ([#431](https://github.com/federicovezzoli/furrow-cam/pull/431))
- Operations that cut where a locating pin goes now warn, so the end mill doesn't run into the pins once the stock is turned over. ([#414](https://github.com/federicovezzoli/furrow-cam/pull/414))
- Updated dependencies: @furrow/ui@0.6.0, @furrow/document@0.17.0, @furrow/cam-core@0.16.0, @furrow/post@0.14.0

## 0.16.0

### Minor Changes

- The operations pane shows about how long each operation takes to cut on the project's machine, and the total for the job (per side in a two-sided project). Exported G-code states the estimate in its header. ([#422](https://github.com/federicovezzoli/furrow-cam/pull/422))

### Patch Changes

- Add a local MCP server through which an AI assistant can create, open, summarise and save Furrow CAM projects on your computer. Before its first change to a project, the project is kept as a version you can restore. ([#415](https://github.com/federicovezzoli/furrow-cam/pull/415))
- Updated dependencies: @furrow/post@0.13.0, @furrow/ui@0.5.0

## 0.15.0

### Minor Changes

- Two-sided projects without a spoilboard to drill into can line the turned-over stock up by a corner pushed into a fence corner instead of on pins. The G-code says which corner to push into the fences and the stock size the two sides depend on, so it can be measured first. ([#391](https://github.com/federicovezzoli/furrow-cam/pull/391))
- 3D finishing can now cover a margin around the model or the whole stock, like roughing, so the floor of a roughed margin is finished down to the model's bottom and the stock top beyond it is left alone. ([#402](https://github.com/federicovezzoli/furrow-cam/pull/402))
- Two-sided projects can have locating pins: set their diameter, their positions along the flip axis and whether their holes go through into the spoilboard or only into the stock, then drill them on the top side. The viewport shows the pins on both sides, and the bottom side's G-code says to turn the stock over onto them. ([#390](https://github.com/federicovezzoli/furrow-cam/pull/390))
- Pockets can clear outside their paths, down to the stock edge so the shape stays raised, or on the paths themselves, besides inside as before. ([#394](https://github.com/federicovezzoli/furrow-cam/pull/394))
- Two-sided projects can hold the part with tabs that the bottom side leaves at the parting depth, spread round each model and dragged along its outline. Each side now also cuts all of the model it can see, so models that aren't widest at the parting depth are cut without a skirt. ([#392](https://github.com/federicovezzoli/furrow-cam/pull/392))
- Projects can be made two-sided in the project properties, choosing the axis the stock is turned over about and the parting depth. A Top / Bottom switch in the viewport shows each side, and the bottom side's simulation starts from the stock the top side leaves, turned over. Operations show their side, and new ones go on the side in view. ([#383](https://github.com/federicovezzoli/furrow-cam/pull/383))

### Patch Changes

- A drawing's *Angle* field now shows how far the drawing is turned, follows the 90° buttons and mirroring, and turns the drawing to the angle you type; 0 brings it back to how it was imported. ([#406](https://github.com/federicovezzoli/furrow-cam/pull/406))
- The simulator now plays back both sides of a two-sided project: switch to the bottom side to watch its operations cut the stock the top side left, turned over. ([#403](https://github.com/federicovezzoli/furrow-cam/pull/403))
- Opening a project no longer logs a `THREE.Clock` deprecation warning in the browser console. ([#407](https://github.com/federicovezzoli/furrow-cam/pull/407))
- Updated dependencies: @furrow/document@0.16.0, @furrow/ui@0.4.0, @furrow/cam-core@0.15.0, @furrow/post@0.12.0

## 0.14.0

### Minor Changes

- *Convert to drawing* turns a text item into a plain drawing that keeps its letters and the operations that machine them, but can no longer be edited as text. ([#384](https://github.com/federicovezzoli/furrow-cam/pull/384))
- Projects can now hold uploaded fonts as files of their own, stored, exported and imported with the project like 3D models, in the web app, for guests and in the desktop app. Projects saved by this release can't be opened by older ones. ([#388](https://github.com/federicovezzoli/furrow-cam/pull/388))
- Text can run over several lines, each aligned on its own, with a line spacing and a letter spacing you can set. Projects saved by this release can't be opened by older ones. ([#381](https://github.com/federicovezzoli/furrow-cam/pull/381))
- Upload your own TTF, OTF or WOFF font into a project from the text panel, marking it single-stroke for engraving if it is, and use it for any text in the project. ([#389](https://github.com/federicovezzoli/furrow-cam/pull/389))

### Patch Changes

- Profiles, pockets, drilling, engraving and V-carving can cut the bottom side of a two-sided project, on the drawing as seen from below, and export with the bottom side's G-code. ([#380](https://github.com/federicovezzoli/furrow-cam/pull/380))
- Updated dependencies: @furrow/cam-core@0.14.0, @furrow/document@0.15.0, @furrow/post@0.11.1, @furrow/ui@0.3.5

## 0.13.0

### Minor Changes

- Add text to a project with *Add text*: type it, pick a font, a letter height and an alignment, and change any of them later. The text stays where it is and the operations that machine it keep doing so. It moves, resizes, turns, mirrors and duplicates like a drawing. ([#379](https://github.com/federicovezzoli/furrow-cam/pull/379))
- Adds the four open-licence fonts text will use, JetBrains Mono, Arvo, Pacifico and the single-stroke Relief SingleLine, with their licences, and lays single-stroke TrueType fonts out as open strokes, without a line closing each one. ([#377](https://github.com/federicovezzoli/furrow-cam/pull/377))
- A two-sided project exports one G-code file per side, such as `Owl-top.gcode` and `Owl-bottom.gcode`, and each file's header says when to turn the stock over and how to zero it. ([#378](https://github.com/federicovezzoli/furrow-cam/pull/378))
- Projects can now store text items, which keep their text, font, height and placement and machine like any drawing. Projects saved by this release can't be opened by older ones. ([#373](https://github.com/federicovezzoli/furrow-cam/pull/373))

### Patch Changes

- 3D roughing and finishing can cut the bottom side of a two-sided project, on the model as seen from below, and each side stops at the parting plane. G-code export covers the top side only until each side gets its own file. ([#376](https://github.com/federicovezzoli/furrow-cam/pull/376))
- Projects can now record a two-sided setup, the axis the stock is turned over about and where the two sides part, and which side each operation cuts; existing projects open as one-sided. Turning it on in the workspace comes in a later release. ([#374](https://github.com/federicovezzoli/furrow-cam/pull/374))
- Updated dependencies: @furrow/cam-core@0.13.0, @furrow/post@0.11.0, @furrow/ui@0.3.4, @furrow/document@0.14.0

## 0.12.2

### Patch Changes

- Updated dependencies: @furrow/ui@0.3.3

## 0.12.1

### Patch Changes

- Furrow CAM has the logo and colours of furrow.cam: an F as a round end mill would carve it, for the favicons, the installable web app and the desktop app icon, and warm paper greys with an orange focus ring throughout the app. Panels floating over the 3D view blur what lies behind them. ([`033a756`](https://github.com/federicovezzoli/furrow-cam/commit/033a756b90c6014de4ab969143c415999782d157))
- The workspace sidebar now shows Operations and Properties as two tabs, so the project's properties are always one click away. Importing another drawing and the project's versions moved to labelled buttons in the top bar. ([`242d067`](https://github.com/federicovezzoli/furrow-cam/commit/242d0679471253336e346841a3d8ec852498ed59))
- Updated dependencies: @furrow/ui@0.3.2

## 0.12.0

### Minor Changes

- Operations are reordered by dragging the handle at the start of their row, or with ↑ and ↓ while the handle is focused, instead of with up and down arrow buttons. ([#343](https://github.com/federicovezzoli/furrow-cam/pull/343))

### Patch Changes

- The Versions pane now says why when the list of versions can't be loaded, instead of showing "Loading versions…" forever. ([#341](https://github.com/federicovezzoli/furrow-cam/pull/341))
- Updated dependencies: @furrow/ui@0.3.1, @furrow/document@0.13.1, @furrow/cam-core@0.12.1, @furrow/post@0.10.1

## 0.11.0

### Minor Changes

- You can duplicate a drawing from its properties. The copy lands 10 mm to its right and is selected, ready to move; it is machined by the same operations, with the same profile tabs. ([#336](https://github.com/federicovezzoli/furrow-cam/pull/336))
- Errors, confirmations and renames now open in an in-app dialog that matches the theme, instead of the browser's own alert, confirm and prompt boxes. ([#338](https://github.com/federicovezzoli/furrow-cam/pull/338))
- The step-over is now set on each pocket, drill, V-carve flat bottom and 3D roughing operation instead of on the bit, so operations with the same bit can use different step-overs. Existing projects keep the step-over their bits had. ([#335](https://github.com/federicovezzoli/furrow-cam/pull/335))
- While toolpaths compute, a toast in the viewport's bottom left corner shows the operation computing now, its progress and how many are done, with a button to cancel it. The operation's properties also show its progress as a percentage. ([#337](https://github.com/federicovezzoli/furrow-cam/pull/337))
- With a touch-off pad, the tool-change field now always shows the block that runs at each tool change, derived from the machine's unless you edit it, and **Reset** goes back to that block. Exported programs follow it: a machine tool change that moves now has its move put on the pad, and the default pause no longer names the bit, since the comment just before it already does. ([#320](https://github.com/federicovezzoli/furrow-cam/pull/320))

### Patch Changes

- Error messages from saving, importing and managing projects, tools, machines and 3D models are now shown in the language the page is displayed in. ([#331](https://github.com/federicovezzoli/furrow-cam/pull/331))
- Saving changes to a machine now keeps you on its page with a confirmation, and open projects pick up the new settings without reloading the page. ([#322](https://github.com/federicovezzoli/furrow-cam/pull/322))
- Updated dependencies: @furrow/ui@0.3.0, @furrow/document@0.13.0, @furrow/cam-core@0.12.0, @furrow/post@0.10.0

## 0.10.0

### Minor Changes

- Clicking a drawing's shape now also shows the drawing's properties over the viewport, where you can set its width or height (it keeps its proportions), fit it to the stock with a border, or remove it. Profile tabs placed on its paths move with it. A new drawing now lands its border in from the zero's anchor. The selected drawing is shaded in the viewport, and selected paths have a faint outline so they stand out on the stock. ([#316](https://github.com/federicovezzoli/furrow-cam/pull/316))
- You can move a drawing: drag it in the top view, or set its X and Y position from the zero in its properties. Profile tabs on its paths move with it. Its properties warn when part of it lies outside the stock, and its border is now the margin Fit to stock leaves, set next to that button. ([#317](https://github.com/federicovezzoli/furrow-cam/pull/317))
- You can mirror a drawing left to right or top to bottom, and turn it by 90° steps or by any angle, from its properties. It stays in place at the zero's anchor, and profile tabs on its paths turn with it. ([#318](https://github.com/federicovezzoli/furrow-cam/pull/318))
- A project can now hold several drawings: each SVG or DXF file you import is added as its own drawing, aligned to the stock at the XY zero. A project holds drawings or one STL model, not both. Existing projects open with their shapes as one drawing. ([#315](https://github.com/federicovezzoli/furrow-cam/pull/315))

### Patch Changes

- Dragging or scrubbing a value keeps one undo step's worth of memory, however long the gesture, instead of a copy per pointer move. ([#317](https://github.com/federicovezzoli/furrow-cam/pull/317))
- Updated dependencies: @furrow/cam-core@0.11.0, @furrow/document@0.12.0, @furrow/post@0.9.1, @furrow/ui@0.2.1

## 0.9.0

### Minor Changes

- Toolpath and import warnings, file errors, export messages and form validation now appear in English, Italian, French or German. ([#305](https://github.com/federicovezzoli/furrow-cam/pull/305))
- Furrow CAM starts in your browser's or system's language when it's English, Italian, French or German, and a new language button next to the theme toggle lets you pick another. Only a few labels are translated so far; the rest follows in upcoming releases. ([#301](https://github.com/federicovezzoli/furrow-cam/pull/301))
- The CAM workspace, including its operations, bit and machine forms, machine presets, simulator and guided tour, now appears in English, Italian, French or German. In Italian, French and German, number fields also accept a comma as the decimal point. ([#306](https://github.com/federicovezzoli/furrow-cam/pull/306))

### Patch Changes

- Updated dependencies: @furrow/document@0.11.0, @furrow/cam-core@0.10.0, @furrow/post@0.9.0, @furrow/ui@0.2.0

## 0.8.0

### Minor Changes

- A model's border is now editable next to **Fit to stock** (10 mm by default, 0 to fit edge to edge), and the Position fields say more clearly that they move the model rather than set the border. ([#272](https://github.com/federicovezzoli/furrow-cam/pull/272))

### Patch Changes

- Updated dependencies: @furrow/document@0.10.0, @furrow/cam-core@0.9.0, @furrow/post@0.8.2, @furrow/ui@0.1.6

## 0.7.0

### Minor Changes

- Anonymous usage statistics and error reports with PostHog replace GoatCounter page-view counts: no cookies, nothing linked to your account, and no projects, file names or drawings sent. The desktop app asks first and can be switched off in the Help menu. ([#285](https://github.com/federicovezzoli/furrow-cam/pull/285))
- Report a bug from the workspace's top bar, the footer or the desktop app's Help menu: it opens a GitHub issue filled in with your description and diagnostics you can review first, plus a screenshot of the viewport to paste into it. ([#282](https://github.com/federicovezzoli/furrow-cam/pull/282))

### Patch Changes

- Custom G-code blocks, the machine's and a touch-off pad's tool change, can now use `{safeZ}`, and **Suggest** rises to it, so the exported program retracts to the machine's current safe Z instead of the one set when Suggest was clicked. If you clicked Suggest before this release, click it again to pick this up. A placeholder the post can't fill in, such as a misspelt `{safez}`, now warns at export. ([#269](https://github.com/federicovezzoli/furrow-cam/pull/269))
- Updated dependencies: @furrow/post@0.8.1

## 0.6.0

### Minor Changes

- G-code now waits for the spindle to reach speed (`G4`) after starting it or raising its speed, before the bit moves. Machine profiles have a spin-up delay, 5 seconds by default, for existing machines and projects too; a manual spindle, switched on by hand, gets no wait. ([#264](https://github.com/federicovezzoli/furrow-cam/pull/264))

### Patch Changes

- Autosave no longer stops for the rest of the session after a refusal you can fix, such as being signed out, an edit the project can't store, or a model whose file isn't uploaded: it saves again with the next change, or when you come back to the window. A conflict with a save made elsewhere still stops it. ([#266](https://github.com/federicovezzoli/furrow-cam/pull/266))
- Profiles, pockets and 3D roughing and finishing no longer take drill bits, which snap when moved sideways through the stock: the tool picker disables them, and new operations start with a bit that cuts sideways. A project saved with a drill bit on one of these operations still opens; the operation shows why it has no toolpath until you pick another bit, and G-code export refuses the project rather than leaving that operation out. ([#262](https://github.com/federicovezzoli/furrow-cam/pull/262))
- Editing the project while its G-code is being exported no longer downloads the program of the project as it was when you clicked Export: the export starts again and downloads what the screen shows. If the project keeps changing, the export stops and asks you to export again once you're done editing. ([#265](https://github.com/federicovezzoli/furrow-cam/pull/265))
- Leaving a project with changes that can't be saved, through All projects, another in-app link or the browser's Back button, now asks first instead of dropping them. ([#267](https://github.com/federicovezzoli/furrow-cam/pull/267))
- Updated dependencies: @furrow/document@0.9.0, @furrow/cam-core@0.8.4, @furrow/post@0.8.0, @furrow/ui@0.1.5

## 0.5.1

### Patch Changes

- Updated dependencies: @furrow/cam-core@0.8.3, @furrow/post@0.7.3, @furrow/ui@0.1.4

## 0.5.0

### Minor Changes

- Without an account, projects now have their own addresses (`/projects/…`) like an account's, you can add and edit your own bits, and `/new` opens a new project straight in the workspace. The project list mentions the desktop app as a way to keep your work. ([#237](https://github.com/federicovezzoli/furrow-cam/pull/237))

## 0.4.0

### Minor Changes

- Operations can now use common bits from a built-in catalog (flat end mills in metric and imperial sizes, ball nose and V-bits), with cautious feeds for softwood and plywood. Editing a catalog bit saves your own copy to your library. ([#230](https://github.com/federicovezzoli/furrow-cam/pull/230))
- Without an account, exporting G-code, setting up a machine or saving your own bits now explains what they need, with a free account, the desktop app for your system, or the project saved as a file. ([#232](https://github.com/federicovezzoli/furrow-cam/pull/232))
- You can use Furrow CAM without an account: app.furrow.cam opens the workspace straight away, and your projects are kept in your browser until you sign up. ([#231](https://github.com/federicovezzoli/furrow-cam/pull/231))

### Patch Changes

- You can create and import projects before adding a machine, and choose the machine in the project when you're ready to export G-code. ([#228](https://github.com/federicovezzoli/furrow-cam/pull/228))
- Updated dependencies: @furrow/document@0.8.0, @furrow/cam-core@0.8.2, @furrow/post@0.7.2, @furrow/ui@0.1.3

## 0.3.0

### Minor Changes

- The desktop app now remembers the workspace's panel sizes and collapsed panes between projects and launches, as the web app does. ([#207](https://github.com/federicovezzoli/furrow-cam/pull/207))

### Patch Changes

- Updated dependencies: @furrow/document@0.7.1, @furrow/cam-core@0.8.1, @furrow/post@0.7.1, @furrow/ui@0.1.2

## 0.2.0

### Minor Changes

- A desktop app for macOS, Windows and Linux that works offline with no account: projects are saved as `.furrow` files with their versions, unsaved changes are offered back after a crash, and the bits library and machines are kept on the computer. ([#195](https://github.com/federicovezzoli/furrow-cam/pull/195))

### Patch Changes

- Updated dependencies: @furrow/ui@0.1.1, @furrow/document@0.7.0, @furrow/cam-core@0.8.0, @furrow/post@0.7.0
