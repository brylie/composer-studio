// Application state — presentation-only "which marker is being edited" state
// for an EventTrackLane (tracks.md#shared-lane-component). One instance per
// lane (scale/chord/labels); factored out so PianoRoll.svelte doesn't
// triplicate the same open/save/delete/move wiring per track type.

import type { EventTrack, TimelineEvent } from './timeline.js';

export interface LaneEditorTarget<T extends TimelineEvent> {
  beat: number;
  existing: T | null;
}

export interface LaneEditorController<T extends TimelineEvent> {
  readonly target: LaneEditorTarget<T> | null;
  /** Opens the editor at `beat`, pre-filling whatever marker already occupies it, if any. */
  openAt: (beat: number) => void;
  /** Opens the editor for an existing marker directly (e.g. from a lane click). */
  openFor: (event: T) => void;
  save: (event: T) => void;
  delete: (id: string) => void;
  move: (event: T, beat: number) => void;
  close: () => void;
}

/**
 * Every method below is an arrow function (not object-literal method
 * shorthand) specifically so callers — PianoRoll.svelte binds these directly
 * to EventTrackLane/OverlayShell props — can pass a bare reference without
 * tripping `@typescript-eslint/unbound-method`: an arrow function can never
 * have an unbound-`this` problem, since it has no `this` of its own.
 */
export function createLaneEditor<T extends TimelineEvent>(
  getTrack: () => EventTrack<T>,
  upsert: (event: T) => void,
  remove: (id: string) => void,
  moveTo: (id: string, beat: number) => void,
): LaneEditorController<T> {
  let target: LaneEditorTarget<T> | null = $state(null);

  return {
    get target() {
      return target;
    },
    openAt: (beat: number) => {
      const existing = getTrack().find((e) => e.beat === beat) ?? null;
      target = { beat, existing };
    },
    openFor: (event: T) => {
      target = { beat: event.beat, existing: event };
    },
    save: (event: T) => {
      upsert(event);
      target = null;
    },
    delete: (id: string) => {
      remove(id);
      target = null;
    },
    move: (event: T, beat: number) => {
      moveTo(event.id, beat);
    },
    close: () => {
      target = null;
    },
  };
}
