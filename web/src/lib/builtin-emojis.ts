import names from '../data/builtin-emoji-names.json';

// Snapshot provenance and regeneration steps: docs/builtin-emojis.md.
// Emojiful matches every alias case-insensitively, without equating '-' and '_'.
const builtinNames = new Set(names);

export function isBuiltinEmojiName(name: string): boolean {
  const normalized = name
    .replace(/^[\u0009-\u000d ]+|[\u0009-\u000d ]+$/g, '')
    .replace(/^:|:$/g, '')
    .replace(/[A-Z]/g, (letter) => letter.toLowerCase());
  return builtinNames.has(normalized);
}
