# Persistence Specification

## Overview

Nothing in the specs so far describes how a composition survives a page
reload, or how it gets from your machine to your friend's. This fills that
gap, scoped to what [README.md](./README.md#scope) settled on: **local-first,
with a shareable project file** — no backend, no accounts, no real-time sync.
Each person composes independently most of the time and occasionally hands
the other a file; there's no merge/conflict story to build because there's
no concurrent editing of the same document.

This is a genuinely load-bearing gap: every other spec assumes a document
exists in memory. This one covers how it gets created, saved, reopened, and
shared.

---

## Two separate formats, two separate purposes

|                 | Project file                                 | MIDI export                                                               |
| --------------- | -------------------------------------------- | ------------------------------------------------------------------------- |
| Purpose         | Save/reopen/share _this app's_ full document | Render to a standard format for other software or people without this app |
| Round-trippable | Yes — lossless                               | No — one-way, loses scale/chord/arranger/synth data                       |
| Contains        | Everything below                             | Notes only, quantized to ticks                                            |

Both already exist in concept (`export-midi` is in the
[command registry](./transformations.md#export)) or need to; they don't
conflict, they solve different problems.

---

## Project file format

```typescript
interface ProjectFile {
  schemaVersion: number; // starts at 1 — see Migrations below
  id: string;
  title: string;
  createdAt: string; // ISO 8601
  modifiedAt: string;
  notes: Note[];
  tempoTrack: TempoEvent[];
  timeSignatureTrack: TimeSignatureEvent[];
  scaleTrack: ScaleEvent[];
  chordTrack: ChordEvent[];
  labelTrack: LabelEvent[];
  arrangerSections: ArrangerSection[];
  synthSettings: SynthSettings; // or InstrumentSettings, once libraries.md's Tone.js migration lands
  loopStart: number;
  loopEnd: number;
  loopEnabled: boolean;
  totalBeats: number;
}
```

Plain JSON — human-diffable (relevant for "pass the file to my friend, they
tweak something, they send it back"), no binary encoding.

Not shown above because it isn't part of the current v1 schema: when
[layers.md](./layers.md) lands, `ProjectFile` gains a `layers: LayerStack`
field and `Note` gains `layerId`, via exactly the migration-chain mechanism
below — a clean, concrete instance of the additive-schema-change case this
document was designed for (see [layers.md#persistence](./layers.md#persistence)).

### What's deliberately _not_ persisted

- **Undo/redo history** — resets on load/reopen. Carrying history across a
  save would mean serializing every `DocumentSnapshot` in the stack, which
  balloons file size for little benefit; this matches how most editors treat
  save vs. history.
- **Selection state, ribbon UI state (active tab, drawer open)** — pure
  presentation state, irrelevant to the document itself.

### Migrations

Every spec in this directory covering scale/chord/arranger tracks is marked
"placeholder" — the schema _will_ grow. `schemaVersion` exists so an old file
opened in newer app code doesn't just silently misread new fields:

```typescript
const migrations: Record<number, (doc: unknown) => unknown> = {
  // 1: (doc) => ({ ...doc, labelTrack: [] }), // example: field added in schema v2
};

function hasSchemaVersion(doc: unknown): doc is { schemaVersion: number } {
  return (
    typeof doc === 'object' &&
    doc !== null &&
    typeof (doc as { schemaVersion?: unknown }).schemaVersion === 'number'
  );
}

function loadProjectFile(raw: unknown): ProjectFile {
  if (!hasSchemaVersion(raw)) {
    throw new ProjectFileError('Not a recognizable project file');
  }
  if (raw.schemaVersion > CURRENT_SCHEMA_VERSION) {
    // Saved by a newer version of the app than this one supports — don't
    // guess at how to read it.
    throw new ProjectFileError(
      `This file needs a newer version of Composer Studio (schema v${raw.schemaVersion})`,
    );
  }

  let doc: unknown = raw;
  while (hasSchemaVersion(doc) && doc.schemaVersion < CURRENT_SCHEMA_VERSION) {
    const migrate = migrations[doc.schemaVersion];
    if (!migrate) {
      // A gap in the migration chain is a bug in this app, not a bad file —
      // fail loudly rather than silently returning a half-migrated document.
      throw new ProjectFileError(`No migration registered for schema v${doc.schemaVersion}`);
    }
    doc = migrate(doc);
  }

  if (!hasSchemaVersion(doc) || doc.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    throw new ProjectFileError('Migration produced an invalid document');
  }
  return doc as ProjectFile;
}
```

Three distinct failure modes, each rejected explicitly rather than left to
crash on a bad property access or silently produce a half-valid document:
a file that isn't shaped like a `ProjectFile` at all, a `schemaVersion`
newer than this app version understands, and a missing migration step for
some version in between. [Import Project](#export--import-the-sharing-mechanism)
surfaces `ProjectFileError` as a user-facing message rather than letting it
propagate as an unhandled exception.

Each migration only needs to bridge one version step; they compose.

---

## Storage: autosave + project library

A single "current document" slot isn't enough — the Top Bar's "Back" control
(from [ribbon.md](./ribbon.md#top-bar)) implies somewhere to go back _to_,
and starting a new piece shouldn't silently overwrite the last one. So:

### IndexedDB, not localStorage

Project documents (notes + several event tracks) can get larger than
`localStorage`'s conservative quota comfortably allows, and `localStorage` is
synchronous (blocks the main thread). IndexedDB is async and has a much
larger practical quota — use it for both the project library and each
project's autosaved state.

### Project library

```typescript
interface ProjectSummary {
  id: string;
  title: string;
  modifiedAt: string;
  noteCount: number; // cheap "how developed is this piece" signal for a list view
}
```

An outer view (the Top Bar's "Back" destination) lists `ProjectSummary[]`
with New / Open / Duplicate / Delete. The library's visual design is out of
scope here, same as other UI placeholders in this directory — only the data
model and the fact that Back returns here are being nailed down now, because
`ribbon.md` already presupposes it exists. New and Open both replace the
in-memory document, so both go through the
[flush-before-replace step](#flush-before-any-document-replacing-action)
below, same as Import.

### Autosave trigger

Debounced, and hooked to an existing invariant rather than a new one:
autosave after each [`CommandHistory.record()`](./command-history.md) call —
i.e. once per completed user gesture, the same boundary already used for
undo steps. No separate "has this changed" tracking needed; if there's a new
history entry, there's something to save.

### Flush before any document-replacing action

Because autosave is debounced, there's a window — between the last
`CommandHistory.record()` and the debounce timer firing — where the most
recent edit exists only in memory. Any action that **replaces the in-memory
document** (Import Project below, opening a different project from the
library, starting New) must cancel the pending debounce timer and write
immediately, awaiting that write before proceeding. Skipping this means the
"are there unsaved changes?" check driving the confirmation prompt can read
stale state and answer "no" while a real edit is about to be silently
discarded — the confirmation exists specifically to prevent that, so it has
to run against current state, not a debounce window's worth of stale state.

Every document-replacing action goes through this same flush-then-check
step rather than each one growing its own version of the same guard.

---

## Export / Import (the sharing mechanism)

- **Export Project** — downloads the current document as
  `<title>.composer-studio.json` (plain `.json` MIME type; the compound name
  is a convention for recognizability, not a registered file association).
- **Import Project** — file picker, validates against `ProjectFile` (running
  it through the migration chain above if it's an older `schemaVersion`),
  [flushes the pending autosave](#flush-before-any-document-replacing-action)
  first, then **replaces the current document** after a confirmation prompt
  if there are unsaved changes — this is a destructive action on the
  in-progress document and follows the same confirm-before-destructive
  pattern already used for Clear All ([piano-roll.md](./piano-roll.md#toolbar)).
- Both are registry commands (`export-project`, `import-project`), same as
  `export-midi`, so they appear in the ribbon's Export tab and the future
  command palette without special-casing.

---

## Future Work

- Conflict handling would only become relevant if "pass-the-file" ever
  becomes "edit-the-same-file-concurrently" — explicitly out of scope per the
  usage pattern this was scoped against (see [README.md](./README.md#scope));
  revisit only if that assumption changes.
- Project thumbnails/previews in the library view (beyond `noteCount`)
