# Built-in Avatar Library Implementation Plan

## 1. Executive summary

Cueola should add the curated avatar library to the existing **Your profile** modal and serve its images as immutable Firebase Hosting assets. The repository is a static, vanilla JavaScript application deployed directly from the repository root; it does not currently use a package manager, build step, Firebase Authentication, Cloud Storage SDK, or a durable user-profile collection. Although the Firebase configuration names a Storage bucket, no Storage client or `storage.rules` exists. Firebase Hosting is therefore the existing, deployed, read-only asset provider that best fits a curated library.

The first release should add 72 versioned 512 × 512 WebP files under `assets/avatars/v1/`, a source-controlled JavaScript manifest, and Python validation/preparation scripts consistent with the repository's existing tooling. A selected library avatar should be represented only by a stable ID such as `animal-fox-01`, never by a URL or file contents.

There is no safe account-level database migration available today. Cueola's present profile is stored per device in `localStorage` under `cueola_profile`, and its avatar is stamped into Planda Bear notes/replies stored within a session document. The compatible first implementation is to migrate that local profile shape to `{ avatar: { type: "library", avatarId } }`, add the library ID to live presence and new notes, and retain readers for legacy initials, four brand-animal keys, and uploaded data URLs. Cross-device profile persistence must wait for real Firebase Auth and a `users/{uid}` collection; creating a publicly writable profile collection under the present unauthenticated rules is explicitly not recommended.

No implementation should begin until the open product decisions in section 15 are resolved, especially whether custom uploads remain available and whether cross-device persistence is in scope.

## 2. Current Cueola architecture findings

### Confirmed findings

| Area | Repository evidence | Consequence |
|---|---|---|
| Frontend | `index.html` contains application CSS, markup, and modals; `cueola-app.js` is global-scope vanilla JavaScript. There is no frontend framework, bundler, or transpiler. | Build the picker with existing HTML/CSS/JS patterns, not React components or TypeScript. |
| Routing | `firebase.json` rewrites `/flowmingo`, `/outrangutan`, and the catch-all to `index.html`; `/dashboard` maps to `dashboard.html`. Screens are otherwise modal/hash/query driven. | The avatar picker belongs in the existing modal; no route is needed. |
| Profile UI | `index.html` has `#userPortalModal`, opened by `openUserPortal()` from `#entryProfileBtn` and `#pbPortalChip`. | Extend this modal rather than creating a separate account-settings screen. |
| Current avatar choices | `cueola-app.js` supports initials, four approved brand SVGs in `PB_AVATAR_ANIMALS`, and a user-uploaded image. | Provide backward-compatible normalization and an explicit coexistence policy. |
| Current profile persistence | `PB_PROFILE_KEY` is `cueola_profile`; `pbGetProfile()` and `pbSetProfileAvatar()` read/write `localStorage`. The modal says "Just for this device." | There is no account-level profile record or database migration to apply in the first compatible release. |
| Current shared avatar data | `normalizePlandaBearNote()` normalizes a note's `avatar`; `publishPlandaBearNote()` and reply publishing stamp `pbMyAvatar()` into the note/reply embedded in `sessions/{code}`. Presence currently contains name/role/follow state, not a durable user profile. | New notes can carry a compact library ID; existing historical notes must keep rendering. Do not rewrite session history. |
| Authentication | The main app does not import Firebase Auth. Participants join with a session code/name. Dashboard "admin" login compares a client-side hash against `admins/global` and stores `adminSession` locally. | Neither a session participant nor dashboard admin is a Firebase-authenticated identity. RLS-style ownership cannot be enforced. |
| Database | Firestore documents are `sessions/{code}`, `admins/global`, and read-only `accounts/{accountId}` entitlements. There is no schema/migration framework. | Do not invent `users` or treat `accounts` as user profiles. Schema evolution is additive normalization in JavaScript. |
| Security rules | `sessions` is publicly readable/writable; `admins` has shape-limited public writes; `accounts` denies client writes; everything else is denied. Comments state App Check/Auth are still needed. | A new public profile collection would worsen security. Avatar IDs must be client-whitelisted, but that is data hygiene rather than identity security. |
| Storage | The Firebase config contains `storageBucket: "cueola.firebasestorage.app"`, but neither page imports `firebase-storage`, no `storage.rules` exists, and no upload workflow uses the bucket. Static assets are already served by Firebase Hosting. | Use Hosting for the built-in library. Firebase Storage remains an alternative only if operational replacement outside deployments becomes a requirement. |
| Deployment | Firebase Hosting serves the repository root directly. `firebase.json` excludes docs/scripts but includes assets. Image assets receive `public,max-age=31536000,immutable`; source files use manual query-string cache busting. CSP permits images only from self/data/blob. | Self-hosted avatar paths work without a CSP change. Filenames/paths must be immutable. |
| Themes | Nine token-based themes include dark and light variants. | Picker styles must use existing CSS variables and be verified across at least Glacier, Polar Bear, and a brand theme. |
| Tests/tooling | Only `scripts/test-entitlements.mjs` exists; it uses Node assertions. Python scripts are already used for asset generation. There is no CI, test runner, or root `package.json`. | Use Python for image tooling and zero-dependency Node tests for manifest/profile logic; add browser/manual QA rather than pretending a UI test stack exists. |
| Working tree | At planning time, `cueola-app.js` and `index.html` contain unrelated uncommitted edits. | Future implementation must preserve and rebase around those user changes. |

### Confirmed gaps and uncertainties

- The Firebase console state (whether the named Storage bucket is provisioned, its rules, App Check enforcement, and deployment identities) cannot be proved from the repository.
- There is no documented image-license ledger or current avatar asset pipeline.
- There is no CI or browser automation baseline.
- The intended meaning of "users" is ambiguous because Cueola has transient session participants, locally remembered profiles, dashboard admins, and device-scoped entitlement accounts, but no authenticated user identity.

## 3. Recommended architecture

### First compatible release

1. Put curated image files at `assets/avatars/v1/<category>/<immutable-file>.webp` and deploy them with Firebase Hosting.
2. Put the authoritative metadata in a source-controlled JavaScript manifest loaded before `cueola-app.js`. The UI and validation tests consume the same manifest.
3. Store `{ type: "library", avatarId: "animal-fox-01" }` in `cueola_profile.avatar`. Resolve the URL exclusively through the manifest.
4. Stamp the same compact avatar object into new Planda Bear notes/replies and, where useful for live identity, `presence.{presenceId}.avatarId`. Never stamp a path or image URL.
5. Keep rendering legacy `{type:"animal", value}`, `{type:"image", value:dataUrl}`, and `{type:"initials"}` objects. Do not bulk-migrate historical notes.
6. Default missing, disabled, deleted, or malformed IDs to deterministic initials. Log a warning in development, but do not expose a broken image or storage path.

This supports 200+ entries because lookup is map-based, category rendering is incremental, and image bytes load lazily. The 72-entry metadata is small enough to load at startup; the images are not.

### Future authenticated release

Only after Firebase Auth exists, add `users/{uid}` with `avatarId`, `updatedAt`, and optional profile fields. Rules should allow a user to read/write only their document and should validate `avatarId` against an allowlist that the backend can enforce. Because Firestore rules cannot import the JavaScript manifest, strong server-side validation would require either a compact public `avatarCatalog/{id}` collection checked with `exists()`, or a callable/HTTPS backend using Admin SDK. This is a separate architecture change, not a prerequisite for the device-local library.

### Rejected options

- Live Pexels/Unsplash searches: licensing, privacy, availability, moderation, CSP, and inconsistent cropping conflict with the product requirement.
- Saving URLs or storage keys supplied by the browser: permits arbitrary path injection and couples profiles to deployment details.
- A new unauthenticated `profiles` collection: anyone could overwrite anyone's data under the current identity model.
- Base64 copies for built-in avatars: duplicates bytes in local storage/session documents and worsens Firestore document-size pressure.
- Firebase Storage for v1: adds an SDK, rules, CORS/CSP, URL construction, and a second deployment process without providing user-visible value for read-only release assets.

## 4. Data model

### Device profile (exact field to modify now)

The migration target is the value already owned by `PB_PROFILE_KEY` (`cueola_profile`) in `cueola-app.js`:

```js
// localStorage key: cueola_profile
{
  version: 2,
  avatar: {
    type: 'library',
    avatarId: 'animal-fox-01'
  }
}
```

`pbNormalizeAvatar()` should accept only an exact ID present and enabled in the manifest and return the compact normalized object. `pbGetProfile()` should lazily read legacy values and return a v2 in-memory shape; `pbSetProfileAvatar()` should write v2. Lazy migration avoids touching unrelated local storage during boot.

### Firestore/session representation

New Planda Bear notes and replies embedded in `sessions/{code}` should use:

```js
avatar: { type: 'library', avatarId: 'animal-fox-01' }
```

If avatars are added to active participant chips, add only this optional field to the existing map entry:

```js
presence: {
  '<presenceId>': {
    // existing name, role, lastSeen, following, followingId, idx, pbPage...
    avatarId: 'animal-fox-01'
  }
}
```

This is an additive document-shape change, not a database-table migration. Update every presence writer so a heartbeat does not accidentally erase the field, and update `firestore.rules` only if session shape validation is later introduced. Existing sessions and users need no backfill.

### Defaults, invalid IDs, and coexistence

- No avatar: deterministic existing initials/color behavior.
- Invalid/disabled/deleted ID: initials fallback; never construct a URL from the raw value.
- Replaced image: publish a new immutable filename/path and update the manifest; do not overwrite a cached `v1` object.
- Legacy brand animal: keep supported as legacy, or map each to reserved IDs after equivalent library assets exist.
- Legacy uploaded image: keep rendering historical data URLs. Product must choose whether the upload button remains for new selections. If it remains, label it "Custom photo (this device)" and retain current size/type normalization.
- Third-party login image: none exists because Firebase Auth/OAuth is not loaded. Reserve a future `type: 'provider'` only when provider identities are implemented; do not add it now.
- Dashboard admins: their client-side admin record is not a safe general user profile. Do not add avatar data to `admins/global` unless a separate dashboard-avatar requirement is approved.

## 5. Storage structure

Recommended committed/deployed structure:

```text
assets/avatars/
  v1/
    animals/
      animal-fox-01.webp
    nature/
      nature-mountain-01.webp
    sports/
      sports-basketball-01.webp
    food/
    space/
    production/
      production-camera-01.webp
    abstract/
  licenses.json
  sources/                 # gitignored; optional local originals, never hosted
```

The initial counts must be exactly 16 animals, 16 nature, 10 sports, 8 food, 8 space, 8 production/media, and 6 abstract (72 total). `sources/` should be excluded in `.gitignore` and Firebase Hosting even if a contributor accidentally stages it. Only final WebP files and non-sensitive license metadata should deploy.

Regular users receive HTTP GET access only. Firebase Hosting offers no browser upload/delete API, so writes are naturally limited to repository/deployment access. If the team later moves files to Firebase Storage, add `storage.rules` with public reads limited to `/avatars/{version}/{category}/{filename}` and all client writes denied; deployment/Admin SDK credentials perform changes.

## 6. Avatar manifest design

The manifest should live in source control because the catalog is curated, reviewed, released with code/assets, and must be available synchronously for ID validation. A Firestore catalog would add runtime failure and public-read complexity; object metadata would be awkward to query and type-check. Since Cueola has no TypeScript/build step, use an immutable ES5-compatible JavaScript data object plus JSDoc types, and expose it as `window.CUEOLA_AVATARS` before `cueola-app.js`.

Proposed `assets/avatars/avatar-manifest.js`:

```js
'use strict';

/** @typedef {'animals'|'nature'|'sports'|'food'|'space'|'production'|'abstract'} AvatarCategory */
/** @typedef {{
 * id: string,
 * category: AvatarCategory,
 * label: string,
 * path: string,
 * dominantColor?: string,
 * description?: string,
 * enabled: boolean,
 * sortOrder: number
 * }} CueolaAvatar */

/** @type {ReadonlyArray<CueolaAvatar>} */
const avatars = Object.freeze([
  Object.freeze({
    id: 'animal-fox-01',
    category: 'animals',
    label: 'Fox',
    path: 'assets/avatars/v1/animals/animal-fox-01.webp',
    dominantColor: '#B85D32',
    description: 'Portrait of an orange fox on a calm background',
    enabled: true,
    sortOrder: 10
  })
]);

window.CUEOLA_AVATARS = Object.freeze({
  version: 1,
  items: avatars,
  byId: Object.freeze(Object.fromEntries(avatars.map(item => [item.id, item])))
});
```

Add a versioned query string to the manifest script tag following repository convention. Manifest validation must enforce unique IDs/paths/sort positions, valid categories, safe relative paths, required labels/descriptions, boolean `enabled`, and matching files. Disabled entries remain resolvable for existing selections but are hidden from new choices; this prevents a routine moderation removal from breaking profiles. A truly unsafe image may be removed, in which case initials are the fallback.

## 7. User experience

Extend `#userPortalModal`; retain its preview, Save, and Cancel semantics. Opening copies the persisted choice into `_pbPortalDraft`. Selecting/randomizing changes only the draft. Save commits and refreshes all visible avatar consumers; Cancel/escape/backdrop discards the draft.

Recommended layout:

- Header: circular 72 px current preview, name, and concise persistence text ("Saved on this device" until authenticated profiles exist).
- Filter row: `All`, Animals, Nature, Sports, Food, Space, Production, Abstract. Use buttons with `aria-pressed`; make the row horizontally scrollable on narrow phones.
- Actions: Randomize chooses uniformly among enabled entries in the active category (or all). Avoid immediately repeating the current selection when more than one choice exists.
- Grid: desktop 5–6 columns; tablet 4; phone 3. Each item is a button containing a fixed-aspect thumbnail and visible label. Selection uses more than color: accent outline, checkmark, and `aria-pressed="true"`.
- Legacy options: place Initials and, if retained, Custom photo in a separate "Other" group rather than mixing them into categories.
- Loading: render skeleton cells while the manifest script is unavailable only if loading is made asynchronous; with the recommended local script, initial metadata is immediate.
- Empty: "No avatars are available in this category" plus an All action.
- Error: selected/failed image falls back to initials and exposes a polite status message; individual thumbnail failures are disabled and omitted from Randomize.

At 72 entries, render the All metadata but use `loading="lazy"`, `decoding="async"`, explicit `width="96" height="96"`, and CSS `aspect-ratio: 1`. At 200+, initially render 48 All results and append batches with an IntersectionObserver/"Show more" control; category views may render one category in batches. Do not fetch image bytes for hidden categories.

Keyboard behavior:

- Tab reaches filters, Randomize, grid choices, Save, and Cancel in DOM order.
- Arrow keys move among grid items using the current column count; Home/End move to first/last; Enter/Space select.
- Focus remains visible using the repository's `:focus-visible` styles and moves predictably when a filter removes the focused item.
- Announce selection changes and randomization through a small `aria-live="polite"` status element.
- The existing modal focus trap and Escape behavior must continue to work.

All surfaces that display a person's avatar should use one renderer/resolver: profile preview and chip, Planda Bear note/reply avatars, presence bar, rundown presence badges, collaboration badges, and notifications where author avatar data exists. A staged integration may begin with the profile/notes surfaces, but definition of done includes an explicit audit of every initials-only surface.

## 8. Image-preparation pipeline

Use Python because `scripts/build_sf_symbol_css.py` and `scripts/import_sf_symbols.py` establish it as the repository's asset-tooling language. Add a requirements note rather than a root JavaScript package solely for imaging. Prefer Pillow for resize/WebP and perceptual hashing; if it is not already available, document `python3 -m pip install Pillow` in the avatar contributor guide.

Proposed files:

- `scripts/prepare_avatars.py`: read approved originals/metadata, EXIF-orient, center-crop (with optional focal point), resize to 512 × 512, convert to sRGB WebP, strip metadata, and iteratively compress.
- `scripts/generate_avatar_manifest.py`: validate metadata and generate deterministic manifest entries.
- `scripts/validate_avatars.py`: validate final files, IDs, counts, duplicates, file sizes, and circular safe area.
- `assets/avatars/licenses.json`: source URL/creator/license/review date/approver per ID; this ledger need not be loaded by the browser.
- `docs/avatar-contributor-guide.md`: repeatable sourcing and review instructions.

Suggested commands:

```sh
python3 scripts/prepare_avatars.py --input assets/avatars/sources --output assets/avatars/v1 --metadata assets/avatars/licenses.json
python3 scripts/generate_avatar_manifest.py --assets assets/avatars/v1 --licenses assets/avatars/licenses.json --output assets/avatars/avatar-manifest.js
python3 scripts/validate_avatars.py --assets assets/avatars/v1 --manifest assets/avatars/avatar-manifest.js --licenses assets/avatars/licenses.json --strict
node --test scripts/tests/avatar-manifest.test.mjs scripts/tests/avatar-profile.test.mjs
```

Expected strict output should be concise and machine-readable at the end, for example: `PASS: 72 avatars; 72 licensed; 0 invalid; 0 duplicates; max 98,412 bytes` and exit 0. Any error exits nonzero and names the avatar ID/file.

Validation rules:

- exact category counts for release v1 and total 72; configurable minimum/maximum for later releases;
- ID regex `^(animal|nature|sports|food|space|production|abstract)-[a-z0-9]+(?:-[a-z0-9]+)*-[0-9]{2}$` with category-prefix agreement;
- file path exactly derived from ID/category and no `..`, absolute path, slash, query, or encoded traversal in IDs;
- decoded dimensions exactly 512 × 512, WebP format, sRGB/RGB(A), and metadata stripped;
- target at or below 100 KB; strict failure above 110 KB, with 100–110 KB requiring documented exception if quality cannot be preserved;
- perceptual-hash distance threshold to flag likely duplicates for human review (not automatic deletion);
- alpha/background, edge/corner, and center-safe-area reports; generate a contact sheet with circular masks for review;
- licensing fields present and approved; reject unknown, editorial-only, non-redistributable, trademarked, branded, or recognizable character/team/league imagery;
- labels and accessibility descriptions are nonempty and do not make unsupported identity claims.

Sourcing workflow: create a shot list; source only original commissioned work, public-domain/CC0 material, or appropriately licensed stock that permits redistribution in an app; record provenance before download; run automated preparation; conduct two-person licensing/branding review; conduct student/educator/professional suitability review; inspect the generated circular contact sheet at 32, 48, and 72 px; approve manifest; commit finals and ledger; deploy to preview; run smoke tests; then production deploy.

## 9. Security and permissions

- Treat the manifest as the only allowlist. `resolveAvatar(avatarId)` must return an enabled/known entry or `null`; no code may concatenate an untrusted ID into a path.
- Permit only the normalized compact avatar shape in new profile/note/presence writes. Limit string length before lookup.
- Use same-origin Hosting paths. Do not expose private bucket URLs, signed URLs, source originals, license invoices, or contributor personal data.
- Hosting makes files publicly readable and client writes impossible. Repository/Firebase deploy access controls uploads, replacements, and deletion.
- Existing Firestore rules do not authenticate participants. Client validation prevents malformed rendering but cannot make session data trustworthy. App Check enforcement and Firebase Auth remain separate security work.
- If custom uploads remain, current data-URL validation must be retained and strengthened with decoded MIME/dimension checks, EXIF stripping, size limits, error handling, and a clear moderation/privacy warning. Because custom avatars are copied into shared notes, they are content shared with all session readers, not private device data. A report/remove moderation system would be needed before uploads are persisted to a central user profile.
- Apply `referrerpolicy="no-referrer"` only if external sources ever appear; the recommended same-origin design needs none.
- On any lookup or decode failure, render escaped initials. Never echo the rejected ID into HTML unsafely.

## 10. Performance considerations

- Firebase Hosting already provides CDN delivery and one-year immutable caching for WebP. Keep that header.
- Use 512 × 512 source assets but request/display them at fixed 64–96 CSS pixels. A later optimization may generate 128/256 thumbnails with `srcset`; measure before adding variants.
- Set `width`, `height`, and `aspect-ratio` to avoid layout shift; use `object-fit: cover` and circular `overflow:hidden` on consumers.
- Lazy-load grid images and asynchronously decode them. Do not lazy-load the current avatar above the fold.
- Preload only the selected avatar when opening/entering a profile-heavy surface (an `Image()` decode or `<link rel="preload" as="image">`), not all 72.
- Keep the metadata manifest eager because it is small and needed for validation. Batch DOM/image creation for All at 200+ entries.
- Never replace bytes at an already immutable URL. Publish `assets/avatars/v2/...` or use a filename revision such as `animal-fox-01-r2.webp`, update the manifest path, and leave old files for at least one release so cached clients/historical references remain safe. The stable `avatarId` may stay the same while its manifest path advances.
- Include manifest version in its script query string and bump the `cueola-app.js` query when resolver/UI code changes.
- Add an image-error counter during rollout without collecting identity or avatar-selection telemetry unless a privacy policy explicitly permits it.

## 11. Accessibility requirements

- Picker choices need programmatic names such as `Select Fox avatar`; visible labels must match.
- The current profile preview should use alt text like `Current avatar: Fox`. Decorative repeated note/presence images should use empty alt text because adjacent names already identify the person.
- Selection must be communicated by checkmark, border, and `aria-pressed`, not color alone.
- Meet WCAG 2.2 AA contrast for text, focus rings, selected outlines, and status/error messages in all themes.
- Maintain at least 44 × 44 CSS pixel touch targets and adequate spacing on mobile.
- Support 200% zoom, reflow at 320 CSS pixels, text resizing, reduced motion, and forced-colors/high-contrast mode.
- Preserve modal labeling, focus containment, focus return to the opener, Escape cancellation, and no focus loss on filtering/lazy batch append.
- Randomize and Save outcomes must be announced without moving focus.
- Accessibility descriptions describe the artwork, not the user, and should avoid gender/race/species-personality implications.

## 12. Testing strategy

Match the repository today: zero-dependency Node tests for pure JavaScript, Python validation for assets, Firebase Emulator/Rules Playground checks for rule changes, and documented browser QA. Do not add Playwright/Vitest/Jest until the team accepts a package manager and CI baseline.

Automated tests:

- `scripts/tests/avatar-manifest.test.mjs`: schema, category counts, uniqueness, ID/path safety, enabled/sort behavior, and lookup/fallback.
- `scripts/tests/avatar-profile.test.mjs`: v2 save/reload, missing profile, invalid ID, disabled/deleted entry, legacy initials/animal/image compatibility, and URL non-persistence.
- Extract manifest/profile resolver code into browser-and-Node-compatible files or evaluate them with a minimal window/localStorage shim, following `test-entitlements.mjs`.
- `scripts/validate_avatars.py`: dimensions, format, byte ceiling, category totals, filenames, metadata, manifest/file parity, perceptual duplicates, and license completeness.
- If Firestore rules change, add emulator tests for allowed session writes, rejected non-whitelisted shapes where enforceable, read access, denied catalog writes, and regression of dashboard/session behavior. Do not claim authorization coverage from client tests.

Browser/manual matrix:

- Chrome and Safari desktop; Chrome/Safari mobile-sized viewports; Firefox smoke test.
- Open profile, filter every category/All, select, Randomize, Cancel, Save, close/reopen, reload page, and join/rejoin a session.
- Post a new note and reply; verify selected avatar on another client and after reload; verify an old initials, brand-animal, and data-URL note.
- Inject malformed/unknown/disabled IDs and failed image URLs; confirm safe initials fallback and usable error state.
- Test slow/offline/throttled loading, empty filtered data, individual decode failure, and return online.
- Keyboard-only grid navigation, focus trap/return, screen-reader names/state/live announcements, zoom/reflow, reduced motion, and contrast.
- Responsive grid at 320, 375, 768, 1024, and wide desktop widths with no horizontal page overflow.
- Verify at least Glacier, Polar Bear, Koala/Panda, and one saturated brand theme.
- Regression: session join, presence, production-note post/edit/reply/export, existing custom avatar display, entry profile button, and dashboard remain functional.

Add the final manual scenarios to `PROGRESS.md` or a dedicated rehearsal checklist, consistent with repository practice. The initial implementation PR should include test evidence and the generated circular contact sheet.

## 13. Phased implementation plan

### Phase 1 — Repository and architecture preparation

- Create: `docs/avatar-contributor-guide.md`, `scripts/tests/avatar-profile.test.mjs`.
- Modify: `cueola-app.js` to isolate pure profile normalization/resolution only after tests define compatibility; possibly extract `cueola-avatar-profile.js`.
- Dependencies: decisions on custom upload retention and device-only versus authenticated persistence.
- Risks: global-scope coupling; overwriting current uncommitted work; confusing transient participants with accounts.
- Acceptance: data flow and compatibility tests exist; no UI/storage behavior changes; device-only limitation is documented.

### Phase 2 — Storage and manifest

- Create: `assets/avatars/avatar-manifest.js`, `assets/avatars/licenses.json`, empty/final `assets/avatars/v1/<category>/` directories when assets are ready.
- Modify: `index.html` script order/query version, `.gitignore`, `firebase.json` ignore list for source originals if needed.
- Dependencies: approved naming/category vocabulary and v1 license ledger format.
- Risks: accidental deployment of source originals; immutable cache mistakes; manifest loaded after app code.
- Acceptance: safe lookup by ID, no raw-ID path concatenation, exact counts when assets land, same-origin CSP compatibility, source originals excluded.

### Phase 3 — Database/profile changes

- Create: no database migration file (none exists); optional pure profile module/test fixtures.
- Modify: `cueola-app.js` functions `pbGetProfile`, `pbSetProfileAvatar`, `pbNormalizeAvatar`, `pbMyAvatar`, note normalization/publishing, and presence write/normalization if live chips are included.
- Dependencies: manifest lookup API; explicit profile persistence scope.
- Risks: older clients receiving new avatar shape; hot session document growth/writes; heartbeats dropping avatar IDs.
- Acceptance: v2 local profile survives reload; new notes use only `avatarId`; old notes render; invalid IDs fall back; no URL/image copy for library avatars; mixed old/new clients do not crash.

### Phase 4 — Avatar picker UI

- Create: no new route/component framework; optional small `cueola-avatar-picker.js` if global file size warrants separation.
- Modify: `index.html` `#userPortalModal` markup/CSS; `cueola-app.js` portal draft/render/filter/randomize/keyboard/error logic.
- Dependencies: complete manifest API and shared resolver.
- Risks: rendering 72+ buttons, focus conflicts with existing global key handlers, theme regressions, modal overflow on phones.
- Acceptance: preview, All/categories, responsive lazy grid, selected state, Randomize, Save/Cancel, loading/empty/error states, keyboard navigation, labels, and theme coverage meet sections 7 and 11.

### Phase 5 — Profile display integration

- Create: shared avatar renderer helpers/tests if not created earlier.
- Modify: `cueola-app.js` renderers for portal chip, notes/replies, presence (`renderPresence`), Planda Bear collaborator badges, rundown presence badges, and notifications where stored avatar data is available; related CSS in `index.html`.
- Dependencies: normalized avatar available in each data path; presence payload decision.
- Risks: names without avatar data, historical records, broken images, duplicate rendering code, extra session writes.
- Acceptance: selected library avatar appears consistently wherever supported, initials remain a safe default, historical records are unchanged, and no layout shift occurs.

### Phase 6 — Image-preparation tooling

- Create: `scripts/prepare_avatars.py`, `scripts/generate_avatar_manifest.py`, `scripts/validate_avatars.py`, contributor guide updates.
- Modify: `.gitignore` and documentation.
- Dependencies: Pillow and approved license/source metadata schema.
- Risks: nondeterministic compression across Pillow/WebP versions, false duplicate flags, automated crop cutting off subjects.
- Acceptance: one command produces deterministic 512 px WebPs; validation fails actionable violations; manifest generation is stable; circular contact sheet is generated.

### Phase 7 — Testing

- Create: `scripts/tests/avatar-manifest.test.mjs`, fixtures, optional Firebase emulator rules tests if rules change.
- Modify: `PROGRESS.md`/rehearsal checklist with browser/accessibility cases.
- Dependencies: phases 2–6; browser QA access.
- Risks: lack of CI allows validation to be skipped; DOM logic remains lightly automated.
- Acceptance: all Node/Python tests pass; manual matrix is recorded; failures/invalid data are exercised; existing entitlement test still passes.

### Phase 8 — Initial avatar import

- Create: exactly 72 approved WebPs in the specified distribution and generated circular review contact sheet (the latter may be a review artifact rather than hosted production asset).
- Modify: `licenses.json` and generated manifest.
- Dependencies: licensing approval and production/content review.
- Risks: copyright/trademark violations, insensitive imagery, off-center crops, files above budget, duplicated concepts.
- Acceptance: strict validation passes; two-person licensing/content review is recorded; every avatar is legible in a circular crop at small sizes; no commercial/team/character branding.

### Phase 9 — Deployment and monitoring

- Create: optional release checklist entry.
- Modify: `CHANGELOG.md`, asset/script version query strings, deployment documentation if commands change.
- Dependencies: preview Firebase channel/project access, final QA, rollback snapshot.
- Risks: immutable stale assets, missing files/404s, mixed cached clients, CSP surprises, Firebase console settings differing from repository assumptions.
- Acceptance: preview deploy smoke-tested; production `firebase deploy` succeeds; 72 image URLs return WebP with expected cache headers; selected avatar survives reload and another client sees new-note avatar; no elevated error rate; rollback is documented.

## 14. Exact files expected to change

| File | Expected change |
|---|---|
| `index.html` | Load manifest before app; expand profile modal; add responsive/theme/accessibility picker styles; bump app/manifest query versions. |
| `cueola-app.js` | Manifest lookup, v2 profile normalization, legacy compatibility, picker state/actions, avatar renderer, note/reply and optional presence integration. |
| `assets/avatars/avatar-manifest.js` | New generated, source-controlled catalog and lookup. |
| `assets/avatars/licenses.json` | New licensing/provenance ledger. |
| `assets/avatars/v1/<category>/*.webp` | 72 new immutable final assets. |
| `scripts/prepare_avatars.py` | New crop/resize/convert/compress pipeline. |
| `scripts/generate_avatar_manifest.py` | New deterministic manifest generator. |
| `scripts/validate_avatars.py` | New asset/license/manifest validator and contact-sheet output. |
| `scripts/tests/avatar-manifest.test.mjs` | New manifest/lookup unit tests. |
| `scripts/tests/avatar-profile.test.mjs` | New profile migration/fallback unit tests. |
| `.gitignore` | Exclude source originals, temporary conversions, and generated review artifacts as agreed. |
| `firebase.json` | Exclude source originals explicitly if kept inside the repo; no CSP change for same-origin assets. |
| `docs/avatar-contributor-guide.md` | New sourcing, licensing, preparation, review, and release workflow. |
| `PROGRESS.md` | Record manual QA results/checklist according to project convention. |
| `CHANGELOG.md` | Release entry and compatibility notes. |

Conditional files:

- `firestore.rules`: only if session shape validation or a future authenticated profile/catalog is added; not needed merely to store a compact field in currently open `sessions` documents.
- `storage.rules`: only if the implementation changes from recommended Firebase Hosting to Firebase Storage.
- `dashboard.html`: only if dashboard-admin avatars become an explicit product requirement.
- `cueola-avatar-profile.js` / `cueola-avatar-picker.js`: recommended extra browser-global modules if maintainers prefer reducing further growth in `cueola-app.js`; otherwise keep changes localized.

## 15. Risks and open questions

1. **Identity/persistence (blocking product decision):** Is "profile" intentionally device-local, or must a selection follow a person across devices? Cross-device persistence requires Firebase Auth and is materially larger than this feature.
2. **Custom uploads (blocking product decision):** Keep, hide for new choices while retaining legacy rendering, or remove? Central persistence would require moderation/privacy work.
3. **Scope of display:** Should avatars appear only on Planda Bear notes (current behavior), or on all presence/collaboration surfaces? The recommendation is all identity surfaces, but presence writes add session traffic.
4. **Brand avatars:** Should the four existing Cueola brand animals remain a separate legacy/brand group or receive reserved catalog IDs?
5. **Asset ownership:** Who approves licensing, education suitability, and replacements? A named content owner and backup are required before import.
6. **Hosting versus Storage:** Hosting is recommended from repository evidence. Confirm whether operations require replacing catalog assets without a code deployment; if yes, reassess Firebase Storage with explicit rules and deployment tooling.
7. **License ledger visibility:** Confirm whether source URLs/creator names may be public in the repository or whether a sanitized public ledger and private evidence store are needed.
8. **Telemetry/privacy:** Decide whether aggregate selection/image-failure telemetry is desired and covered by policy. Default is no selection tracking.
9. **Browser test investment:** Decide whether to accept Playwright plus a package manager/CI; it would improve keyboard/responsive regression coverage but is not present today.
10. **Current security posture:** Public Firestore session writes and client-side admin codes remain larger risks. The avatar project must not claim to solve authorization.
11. **Concurrent work:** Existing uncommitted edits in `index.html` and `cueola-app.js` must be preserved during implementation.

## 16. Definition of done

- Exactly 72 approved avatars exist in the required category counts, are 512 × 512 WebP, meet the size policy, and pass circular-crop review.
- Every asset has recorded, approved licensing/provenance and no recognizable commercial, team, league, character, or trademarked branding.
- The manifest is source-controlled, deterministic, validated, safe to scale beyond 200, and is the only mapping from ID to path.
- Profiles and new shared records store only stable avatar IDs; no library URL or image copy is persisted.
- Missing, legacy, invalid, disabled, deleted, and failed-image cases render safely and preserve old notes.
- The existing profile modal provides preview, All/categories, responsive grid, selected state, Randomize, Save/Cancel, lazy loading, and complete states.
- Keyboard, screen-reader, contrast, touch-target, zoom/reflow, theme, and reduced-motion requirements pass review.
- Firebase Hosting serves the images with immutable caching; replacement/versioning and rollback procedures are documented.
- Browser clients cannot upload/replace/delete built-in assets; no arbitrary path can be saved or resolved.
- Node tests, Python validation, existing entitlement tests, and the manual browser/accessibility matrix pass.
- Preview and production deployments are smoke-tested; changelog and contributor documentation are complete.
- The release accurately describes profile persistence as device-local unless authenticated profiles are separately implemented.

## Implementation checklist

- [ ] Resolve identity persistence, custom upload, display-scope, and brand-avatar decisions.
- [ ] Preserve/reconcile current uncommitted `index.html` and `cueola-app.js` changes.
- [ ] Define license ledger and immutable ID/file conventions.
- [ ] Add source-controlled manifest and safe lookup.
- [ ] Add v2 local profile normalization with legacy readers.
- [ ] Store only `avatarId` in new library-avatar data.
- [ ] Build accessible, responsive picker in `#userPortalModal`.
- [ ] Integrate shared avatar rendering across approved surfaces.
- [ ] Add Python prepare/generate/validate tools.
- [ ] Source, review, prepare, and validate the 72-image set.
- [ ] Add Node tests and manual accessibility/browser checks.
- [ ] Verify Hosting exclusions, CSP, cache headers, and immutable versioning.
- [ ] Preview deploy, test mixed old/new data, then production deploy.
- [ ] Record QA, monitoring, rollback, contributor docs, and changelog.
