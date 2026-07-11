# Avatar Library Contributor Guide

## Phase 1 scope

This guide records the approved architecture and compatibility boundaries before avatar assets or picker behavior are introduced. Phase 1 does **not** add a manifest, image files, image-processing tools, database fields, or user-interface changes.

Cueola currently stores a device-local profile at `localStorage.cueola_profile`. Its supported avatar values are initials, one of four approved Cueola brand animals, or a small uploaded PNG/JPEG/WebP data URL. New profile work must preserve those shapes until the later migration phase. Historical Planda Bear notes and replies embed those avatar values and must remain readable without a bulk rewrite.

## Architectural boundaries

- The built-in library will use stable IDs, but `type: "library"` is not valid until the manifest and profile migration phases are implemented together.
- Built-in image paths must eventually be resolved from a reviewed manifest. Never construct a path from untrusted profile data.
- Profile persistence remains device-local unless Firebase Authentication and authenticated user profiles are separately approved.
- Do not add a public Firestore profile collection under the current unauthenticated security model.
- Firebase Hosting is the planned delivery mechanism for curated, read-only assets. Firebase Storage is not part of Phase 1.
- Existing custom uploads remain supported during this preparation phase. Whether users may create new uploads after launch is unresolved.

## Compatibility contract

The pure model in `cueola-avatar-profile.js` is the current contract:

- missing, malformed, unknown, or storage-blocked profiles fall back to initials;
- only own keys in the approved brand-animal map are accepted;
- uploaded images must be PNG, JPEG, or WebP base64 data URLs shorter than 60,000 characters;
- normalized values discard unexpected fields;
- storage failures never prevent the profile or notes UI from continuing.

Run the contract tests with:

```sh
node --test scripts/tests/avatar-profile.test.mjs
```

## Later asset contribution workflow

Do not add avatar source images during Phase 1. Before the initial import, the team must resolve and document:

1. who approves licensing and content suitability;
2. whether custom uploads remain selectable;
3. whether avatars appear only in Planda Bear or across all presence surfaces;
4. whether the four brand animals remain separate or receive library IDs;
5. whether public source/creator metadata is acceptable in the repository.

Once those decisions are made, later phases will add the license ledger, immutable naming rules, preparation/validation commands, circular-crop contact sheet, and the required 72-image category distribution described in `docs/avatar-library-plan.md`.
