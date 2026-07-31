// Domain layer — CommandDescriptor registry shapes (transformations.md).

import type { CommandContext, Note } from '../types.js';

export interface ParamFieldBase {
  key: string;
  label: string;
  // Omitted = always shown. Present = the drawer re-evaluates this against
  // the current in-progress values on every change, hiding the field when
  // it returns false.
  showIf?: (values: Record<string, unknown>) => boolean;
  // Omitted = the drawer seeds this field from `default` when opened.
  // Present = seeded from this instead, computed against the live
  // CommandContext (e.g. a value relative to the current playhead).
  getDefault?: (ctx: CommandContext) => unknown;
}

export type ParamField =
  | (ParamFieldBase & {
      type: 'number';
      min?: number;
      max?: number;
      step?: number;
      default: number;
    })
  | (ParamFieldBase & { type: 'range'; min: number; max: number; step?: number; default: number })
  | (ParamFieldBase & {
      type: 'select';
      options: { value: string; label: string }[];
      default: string;
    })
  | (ParamFieldBase & { type: 'boolean'; default: boolean })
  // A paired min/max value, e.g. generate-chords's octaveRange.
  | (ParamFieldBase & {
      type: 'number-range';
      min: number;
      max: number;
      step?: number;
      default: { min: number; max: number };
    });

/**
 * Seeds a value for every field in `fields`: `getDefault(ctx)` when the field
 * declares one, otherwise its static `default`. Shared by CommandRibbon's
 * params drawer and quick-apply's instant-default path so both fill a
 * command's params identically.
 */
export function resolveDefaultParams(
  fields: ParamField[] | undefined,
  ctx: CommandContext,
): Record<string, unknown> {
  return Object.fromEntries(
    (fields ?? []).map((field) => [
      field.key,
      field.getDefault ? field.getDefault(ctx) : field.default,
    ]),
  );
}

export interface CommandDescriptorBase {
  id: string; // stable, kebab-case
  category: 'transform' | 'generate' | 'export' | 'view' | 'transport';
  labelKey: string; // Paraglide message key (ribbon.md i18n) — not wired until Phase 3
  descriptionKey?: string;
  icon: string;
  keywords?: string[];
  shortcut?: string;
  params?: ParamField[]; // omitted = one-click command, no drawer
  isApplicable(ctx: CommandContext): boolean;
  // Only consulted when isApplicable(ctx) is false, to drive the disabled tooltip.
  getDisabledReasonKey?(ctx: CommandContext): string;
}

// Exactly one of `run` or `effect` — a union rather than two optional
// properties, per transformations.md, so a descriptor with neither or both
// fails type-checking instead of only failing at runtime.
export type CommandDescriptor<TParams extends Record<string, unknown> = Record<string, unknown>> =
  | (CommandDescriptorBase & {
      run(ctx: CommandContext, params: TParams): { notes: Note[]; label: string };
      effect?: never;
    })
  | (CommandDescriptorBase & {
      run?: never;
      effect(ctx: CommandContext, params: TParams): Promise<void>;
    });
