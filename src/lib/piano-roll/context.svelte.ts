import { getContext, setContext } from 'svelte';
import type { Store } from './store.svelte.js';
import { createStore } from './store.svelte.js';

interface EditorState {
  store: Store;
}

const KEY = Symbol('editor-state');

/**
 * Call once at the top of a provider component's <script> (e.g. +layout.svelte).
 * Creates a fresh store instance and registers it via Svelte context.
 * Nest a second call in any subtree that needs its own isolated instance
 * (e.g. Storybook stories, tests).
 */
export function provideEditorState(): EditorState {
  const state: EditorState = { store: createStore() };
  setContext(KEY, state);
  return state;
}

/**
 * Retrieve the nearest ancestor's editor state. Throws if no provider
 * is an ancestor — call only during component initialisation.
 */
export function getEditorState(): EditorState {
  return getContext<EditorState>(KEY);
}
