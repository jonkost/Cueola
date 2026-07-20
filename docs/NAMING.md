# Cueola Naming Conventions (v2.1)

The contract for every name that leaves a single file: storage keys, window
globals, CSS prefixes, and identifiers. Written for Phase 1 of V2_1_PLAN.md;
every rule below was grep-verified against the codebase before being written
down. Renames are **opportunistic only** — apply the standard when you touch
the code anyway, never as a bulk sweep.

## 1. localStorage / sessionStorage keys

**Standard:** every persisted key starts with `cueola_`, lowercase snake_case.
Per-entity keys append an id after a trailing underscore
(`cueola_scope_<adminId>`, `cueola_customSources_<sessionId>`,
`cueola_pb_lastread_<...>`).

**Migration shim pattern (read-new-then-old, write-new):**

```js
// read
const v = localStorage.getItem('cueola_new_key') || localStorage.getItem('legacy_key');
// write — new key only; the legacy key ages out naturally
localStorage.setItem('cueola_new_key', v);
```

Shims applied in v2.1 (leave the fallback reads in place through 3.0):

| Legacy key | New key | Where |
|---|---|---|
| `promptypus_theme` | `cueola_prompter_theme` | cueola-app.js |
| `promptypus_script_html` | `cueola_prompter_script_html` | cueola-app.js |
| `og_insp_tab` | `cueola_og_insp_tab` | outrangutan/outrangutan.js |

**Frozen wire keys — never rename.** These are not preferences; they are
cross-window transport (storage-event messaging between the app and the
prompter/script-operator windows). A rename breaks a mixed-version window pair
mid-show (D8 rule 1: never change a wire shape deployed clients consume):

- `promptypus_msg`, `promptypus_ping` (current channel)
- `prompt_up_the_jam_msg`, `prompt_up_the_jam_ping` (legacy channel, still
  dual-listened on purpose)
- BroadcastChannel names `promptypus` / `prompt_up_the_jam`

## 2. Window globals

- **camelCase** for runtime state the app computes and owns:
  `window.cueolaPlatform` (detected platform), `window.cueolaCapabilities`,
  `window.cueolaEntitlements`.
- **UPPER_SNAKE** for external/build-time input flags set *before* the app
  runs and only read by it: `window.CUEOLA_PLATFORM` (native-wrapper build
  flag), `window.CUEOLA_PB_LEAF_SYNC` (dark-launch gate).
  `CUEOLA_PLATFORM` vs `cueolaPlatform` is therefore **not** a duplicate —
  one is the input override, the other the resolved output. Keep both.
- **PascalCase namespaces** for shared modules exposed on window:
  `CueolaEntitlements`, `CueolaIdentity`, `Outrangutan`.
- One top-level declaration per name per page. dashboard.html carried two
  identical `initialsOf` function declarations (the later silently shadowed
  the earlier); deduped in v2.1. Don't reintroduce shadowing — grep before
  adding a top-level function to a page-level script.

## 3. Identifiers: `outrangutan` and `og`

`outrangutan` (full) and `og` (short) are the sanctioned identifiers for the
playback module — folder, file, global, and CSS names. They are **correct as
written**; do not "fix" them to anything else during sweeps.

## 4. CSS class prefixes (documented contract; renames opportunistic only)

| Prefix | Owner / meaning |
|---|---|
| `cc-` | Cueola core components (shared across surfaces) |
| `pt-` | Prompter (Flowmingo) surface |
| `pb-` | Planda Bear / pre-production surface |
| `og-` | Outrangutan playback module |
| `ls-` | Live Show surface |
| `ts-` | Toolbar/topstrip chrome |
| `ec-` | Export/composer paperwork UI |
| `sf-` | SF Symbols runtime (design-system, generated — do not hand-edit) |
| `field-`, `modal-`, `btn-`, `theme-`, `prepro-`, `paperwork-`, `insp-` | Generic shared primitives; no new prefix families without adding them here |

New CSS belongs under an existing prefix. If a genuinely new surface needs a
new prefix, add the row here in the same commit.

## 5. Firestore field names

Wire shapes are governed by D8 rule 1 (V2_1_PLAN.md / design notes): field
names on documents deployed clients read are frozen — new capability means a
new field or a new document, never a renamed or reshaped one. Map keys that
get patched via masked updates must be identifier-safe
(`[a-zA-Z_][a-zA-Z_0-9]*`).
