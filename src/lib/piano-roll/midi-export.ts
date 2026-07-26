import type { Note } from './types.js';

function writeVarLength(value: number): number[] {
  const bytes: number[] = [];
  bytes.unshift(value & 0x7f);
  value >>= 7;
  while (value > 0) {
    bytes.unshift((value & 0x7f) | 0x80);
    value >>= 7;
  }
  return bytes;
}

function int32(value: number): number[] {
  return [(value >> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function int16(value: number): number[] {
  return [(value >> 8) & 0xff, value & 0xff];
}

function eventOrder(statusByte: number): number {
  if (statusByte === 0x80) return 0; // note-off
  if (statusByte === 0x90) return 1; // note-on
  return 2; // meta events (tempo, end-of-track) sort last among ties
}

export function exportMidi(notes: Note[], tempo: number, filename = 'track.mid'): void {
  const TICKS_PER_BEAT = 480;
  const microsecondsPerBeat = Math.round(60_000_000 / tempo);

  interface MidiEvent {
    tick: number;
    data: number[];
  }
  const events: MidiEvent[] = [];

  // Tempo meta-event
  events.push({
    tick: 0,
    data: [0xff, 0x51, 0x03, ...int32(microsecondsPerBeat).slice(1)],
  });

  for (const note of notes) {
    const startTick = Math.round(note.startBeat * TICKS_PER_BEAT);
    const endTick = Math.round((note.startBeat + note.durationBeats) * TICKS_PER_BEAT);
    const vel = Math.max(1, Math.min(127, note.velocity));

    events.push({ tick: startTick, data: [0x90, note.midiNote, vel] });
    events.push({ tick: endTick, data: [0x80, note.midiNote, 0] });
  }

  const lastTick = events.reduce((max, e) => Math.max(max, e.tick), 0);
  events.push({ tick: lastTick, data: [0xff, 0x2f, 0x00] });
  // For equal ticks: note-off (0x80) before note-on (0x90) so a back-to-back
  // same-pitch note doesn't have its off-event silence the following on-event;
  // end-of-track (0xff) always last.
  events.sort((a, b) => {
    if (a.tick !== b.tick) return a.tick - b.tick;
    return eventOrder(a.data[0]) - eventOrder(b.data[0]);
  });

  const trackBytes: number[] = [];
  let prevTick = 0;
  for (const event of events) {
    const delta = event.tick - prevTick;
    prevTick = event.tick;
    trackBytes.push(...writeVarLength(delta), ...event.data);
  }

  const header = [
    0x4d,
    0x54,
    0x68,
    0x64, // MThd
    ...int32(6), // chunk length
    ...int16(0), // format 0
    ...int16(1), // 1 track
    ...int16(TICKS_PER_BEAT),
  ];

  const track = [
    0x4d,
    0x54,
    0x72,
    0x6b, // MTrk
    ...int32(trackBytes.length),
    ...trackBytes,
  ];

  const buffer = new Uint8Array([...header, ...track]);
  const blob = new Blob([buffer], { type: 'audio/midi' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
