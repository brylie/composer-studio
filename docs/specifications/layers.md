# Layers Specification

## Status

Placeholder-tier, like [tracks.md](./tracks.md)'s chord/arranger sections:
enough shape to resolve a real architectural ambiguity now, not enough
detail to commit to final UI. This is explicitly later-stage work, scheduled
after the v1 single-instrument scope in [README.md](./README.md#scope) —
written now because it changes what "multiple instruments" *means*
architecturally, and that answer needs to be settled before
[state-ownership.md](./state-ownership.md) or [selection.md](./selection.md)
make assumptions that would have to be undone later.

---

## The question this resolves

Multi-instrument composition (piano + strings, or a four-part choral
texture) looks at first like it needs multiple tracks — separate timelines,
the way a conventional DAW handles it. [state-ownership.md](./state-ownership.md)
originally framed this as "multiple simultaneous editor instances," each
with its own document, selection, and undo history, which is exactly what
its root-context-with-nested-override pattern was built to support.

That framing doesn't fit this app. Composer Studio has no separate audio
tracks, no per-instrument tempo, no reason for two instruments to ever be at
different points in time — there is exactly **one pitch space** (the
piano-roll's Y-axis) and **one timeline** (its X-axis), regardless of how
many instruments are playing. Multiple tracks would mean multiple
Y-axes/X-axes that all have to stay in lockstep for no reason, since nothing
about pitch or time is actually per-instrument here.

The resolution: instruments are **layers**, not tracks — a single shared
`Note[]` collection, one document, one selection, one undo history (exactly
what Phase 1 already builds), where each note additionally carries a
`layerId`. Layers are a *stacking and editing* concept borrowed from photo
editors (Photoshop-style: reorderable, each with visibility and lock
toggles, top layer wins on overlap), not a *timeline* concept — deliberately
a different word from [timeline.md](./timeline.md)'s "track" (scale/chord/
arranger/labels), which really is a set of independent, time-indexed event
sequences. Layers don't have their own timeline; they partition one.

Helio Sequencer is the closest existing prior art mentioned in discussion,
but it's still track-based underneath (each instrument gets its own
timeline lane, synced by playhead). A single shared canvas where instruments
differ only by which layer their notes belong to — rather than which lane —
doesn't appear to have an existing well-known implementation, as far as this
research went.

---

## Data model

```typescript
interface Layer {
	id: string;
	name: string; // user-editable, e.g. "Piano", "Alto", "Synth Pad"
	instrument: SynthSettings; // or InstrumentSettings, per libraries.md — one per layer, not one global
	color: string; // layer-panel swatch; also usable for note-tinting in the grid (see Open questions)
	visible: boolean;
	locked: boolean;
}

type LayerStack = Layer[]; // array order = panel display order = z-order; index 0 is topmost
```

```typescript
interface Note {
	// ...existing fields (piano-roll.md)
	layerId: string; // references Layer.id
}
```

`SynthSettings`/instrument settings move from a single field on `EditorState`
([piano-roll.md](./piano-roll.md#editorstate-storesveltets)) to a field on
each `Layer` — this is the multi-instrument part of the feature. The Sound
drawer, once layers exist, edits the **active layer's** instrument rather
than one document-wide instrument (see [libraries.md](./libraries.md#mvp-default-instrument-tonepolysynth-over-tonesynth)).

### Active layer

A newly created note (draw-mode tap/click on empty grid space) needs a
layer to belong to — there has to be a notion of which layer is "current,"
independent of visibility/lock, the same way Photoshop has one active layer
that new brush strokes land on regardless of how many other layers are
visible. This is presentation/working state, not document data — it lives
alongside ribbon UI state behind the same [state-ownership.md](./state-ownership.md)
root context, not in `ProjectFile`.

---

## Layer panel

A reorderable list, one row per layer, matching the description from
discussion: drag to reorder (reordering **is** re-stacking — there's no
separate z-index field to keep in sync), a visibility toggle and a lock
toggle per row, topmost row in the list rendering on top in the grid.
Structurally this is another side-panel consumer of
[overlay-shells.md](./overlay-shells.md)'s shared shell — a fourth, after
the ribbon's parameter drawer, the Sound drawer, and the note inspector.

## Rendering and interaction rules

| Layer state | Renders in note grid | Selectable / editable |
| --- | --- | --- |
| Visible, unlocked | Yes | Yes — full pointer interaction |
| Visible, locked | Yes (dimmed, with a lock affordance) | No — excluded from click/marquee hit-testing and from "select all" |
| Hidden (regardless of lock) | No | No — can't select what isn't rendered |

**Overlap, stacking, and z-order**: where two notes from different layers
occupy the same pitch and overlapping time, the topmost visible layer's
note renders on top, per the panel's stacking order. This is purely a
*rendering* rule — it does not change [editing-model.md](./editing-model.md#overlap-policy-notes-may-overlap-freely)'s
existing "notes may overlap freely" policy, and it does not affect
playback: both notes still sound. Layers control what you see and can
click, never what you hear (see below).

**Visibility does not mute.** Hiding a layer stops it from rendering and
from being selectable, but its notes keep playing — the two toggles named
in discussion are visibility and lock, not mute, and conflating "hidden"
with "silent" would be a third control smuggled into two. This does mean
hiding a layer to reduce visual clutter while working on another doesn't
also let you audition the visible layer in isolation; if that turns out to
matter in practice, **solo/mute as controls distinct from visibility** is
the natural extension — flagged here as real future work, not built now,
since nothing in the motivating use case (decluttering the view, protecting
finished parts from stray edits) asked for it.

---

## Selection across layers

This is the part that changes [selection.md](./selection.md): a selection
is **not** confined to one layer. A choral texture (SATB) or any multi-voice
arrangement needs to select, copy, transform, and paste across several
layers at once — e.g. selecting soprano + alto together to transpose a
passage in parallel — so `SelectionContext` gains a layer-equivalent of
[`activeScales`](./selection.md#activescales-selections-arent-bounded-by-scale-boundaries):

```typescript
interface SelectionContext {
	// ...existing fields
	activeLayers: Layer[]; // distinct layers referenced by `notes`, in panel/z-order
}
```

Unlike `activeScales` (which slices a beat range at scale boundaries),
`activeLayers` needs no clamped start/end — a note either belongs to a
layer or it doesn't, there's no partial membership to represent. It's just
the deduplicated set of layers among the selected notes, in stack order,
so a consumer can answer "how many distinct voices are in this selection"
(`activeLayers.length`) or render one swatch per represented layer.

Layer visibility/lock gate **selection eligibility at the interaction
layer**, not inside `SelectionContext` itself — the same division of
responsibility as scale membership being computed for display rather than
enforced. Marquee-select and click only ever hit-test notes on visible,
unlocked layers (per the table above); by the time notes reach
`selectionContext`, that filtering has already happened, so `activeLayers`
never contains a locked or hidden layer as a side effect of how selection
was made, not a rule this module enforces separately.

### Clipboard: preserve layer membership across copy/paste

[`ClipboardContents`](./selection.md#clipboard-copypaste) preserves each
copied note's `layerId`; paste re-inserts notes onto their original layers,
not the currently active layer — this is what makes "copy the alto line,
transpose it, paste it back into the alto layer a few bars later" work as
one gesture instead of three. If a copied note's layer no longer exists at
paste time (deleted between copy and paste), it falls back to the current
active layer rather than silently dropping the note.

---

## Persistence

`ProjectFile` ([persistence.md](./persistence.md)) gains a `layers: LayerStack`
field alongside `notes: Note[]`, and `Note` gains `layerId`. This is a
schema-version bump handled by the existing migration-chain pattern: a
project file saved before layers existed has no `layerId` on any note and
no `layers` array; the migration synthesizes a single default layer (name
"Piano," wrapping the document's previous single `synthSettings`) and
assigns every existing note to it — a clean, concrete instance of the
migration mechanism persistence.md already designed for exactly this kind
of additive schema change.

---

## Audio

One `Tone.Sampler`/`Tone.PolySynth` instance per layer
([libraries.md](./libraries.md#tonejs--adopt-but-its-a-rewrite-not-just-an-addition)),
each built from that layer's `instrument` settings. This is naturally
compatible with the Tone.js rewrite regardless of sequencing timing —
whenever it happens, "one instrument voice per layer" is a small extension
of "one instrument voice," not a redesign.

---

## Open questions

- **Note tinting by layer color.** The layer panel needs a color swatch per
  row regardless; extending that color to tint each note in the grid (so a
  choral score reads as four visually distinct voices at a glance, similar
  to how notation software colors voices) is an attractive, cheap-looking
  extension but would interact with [tracks.md](./tracks.md#context-aware-highlighting)'s
  scale/chord-degree highlighting — two color systems on the same note
  needs a rule (outline vs. fill? one takes priority?) before it's built.
- **Solo/mute as controls distinct from visibility** — see above; only
  worth adding if hide-for-editing and hide-for-listening turn out to be
  different needs in practice.
- **Per-layer default instrument** when a new layer is created — cloning
  the previous layer's settings, or always defaulting to the `PolySynth`
  piano preset, is a small UX decision left for whenever layer creation is
  actually built.
- **Locked-layer note inspector access** — is a locked note fully
  unreachable (can't even open the [note inspector](./editing-model.md#note-inspector-precise-numeric-entry)
  to look at its exact values), or just unreachable for *mutation*? Leaning
  toward view-only inspector access being fine even when locked, since it's
  read, not edit — not decided here.
