# Stage Plot lesson: ready-to-paste draft (2026-08-13)

The layers build shipped without guide coverage because a lesson edit is not
just text: the contract suite fails until the Kokoro narration is regenerated,
and Kokoro only runs on your machine (`.venv-kokoro`). This doc holds the
finished lesson so the paste, the generator, and the narration land in one
errand and the suites never go red in between.

Why a new lesson instead of editing the Planda Bear one: the plot is now an
interactive editor with its own modes (layers, Draw Flow, exports), like KeyWi
and Outrangutan, which each have their own lesson. Touching the existing
`plandabear` rows would force a narration rerun for that lesson too; this way
only the new row needs audio.

## The lesson block

Paste into `LEARNING_LESSONS` in cueola-app.js, directly AFTER the
`id:'plandabear'` entry (it closes with `actions:[['Open Planda Bear','plandabear']] },`):

```js
  {
    id:'stage-plot',
    area:'Planda Bear',
    title:'Draw The System Plot',
    time:'6 min',
    intro:'The Stage Plot is a birdseye map of your space, built in layers: Room, Audio, Video, and Lighting. Each checkpoint is one layer, and the whole build lives on one plot.',
    navigation:[
      'Open Planda Bear from the home screen, then open Stage Plot from the paperwork hub.',
      'The layer bar sits above the canvas: click a chip to work on that layer, click its eye to show or hide it for you only.',
      'The bank on the left holds the gear, grouped by layer. The inspector on the right edits whatever is selected.'
    ],
    steps:[
      'Check the floor plan first. Your instructor assigns the room and its size; you place gear inside it.',
      'Start on the Audio layer: drag gear from the bank onto the plot, or click it to add. New gear takes its layer color automatically.',
      'Click any piece to rename it. Use the label for what matters on paper: unit numbers, dimmer addresses like D3, or positions like Key, Fill, and Back.',
      'Draw the signal flow: press Draw Flow (or F), click the source gear, then the destination. The arrow points the way the signal travels and shows its connector: XLR, BNC, or DMX 5-pin.',
      'Click a cable to change its connector, layer, or direction. Cables follow the gear when it moves, and crossings draw a small bump so runs stay readable.',
      'For the next checkpoint, click the next layer chip and keep building. Hide layers you are not working on with the eye; they come right back.',
      'Fix earlier work any time: select gear to change its layer, label, or spot. Nothing locks between checkpoints.',
      'Export what you see: Preview turns the layers you have showing into a PDF named for them. Layer Set PDF makes one file with each system on its own page plus the combined plot.'
    ],
    callouts:[
      ['Layers are your view','Showing or hiding a layer only changes your screen and your export. Classmates keep their own view of the same shared plot.'],
      ['Cables never dangle','Deleting gear removes every cable attached to it, and undo covers gear and cables alike.'],
      ['One plot, three checkpoints','Audio, Video, and Lighting build on the same plot. No copying forward: the earlier layers are already there.']
    ],
    checks:['I can add gear on the right layer and rename it.','I can draw a cable from source to destination and set its connector.','I can export one layer and the full layer set PDF.'],
    actions:[['Open Planda Bear','plandabear']]
  },
```

## The errand (one sitting, in order)

1. **In your editor:** paste the block above into `LEARNING_LESSONS` in
   cueola-app.js after the `plandabear` entry. Save.
2. **In Terminal, at the repo root:** regenerate the reference doc so it
   matches the code again:

   ```bash
   node scripts/generate-content-reference.mjs
   ```

   You should see docs/content-reference.md rewritten with a new
   `stage-plot` row. (Why: the contract suite diffs this file against the
   generator output byte for byte.)
3. **In Terminal:** render the narration for the new lesson:

   ```bash
   .venv-kokoro/bin/python scripts/generate_cueola_narration.py --force-ref stage-plot
   ```

   You should see one new audio file land under assets/narration/af_heart/
   and the manifest update. (Why: the suite checks every lesson has audio on
   disk, in the manifest, and fresh against the current text.)
4. **In Terminal:** re-hash the versioned assets:

   ```bash
   node scripts/bump-cache.mjs
   ```

   You should see the cueola-app.js and manifest hashes change in index.html
   and sw.js.
5. **In Terminal:** confirm everything is green before committing:

   ```bash
   node --test "scripts/tests/*.test.mjs"
   ```

   You should see 0 failing. If step 5 fails on the narration freshness
   check, rerun step 3 (the usual cause is a text tweak after the audio was
   rendered), then repeat steps 4 and 5.

Edit the lesson wording freely before step 3; only rerun steps 2 through 5
after any change.
