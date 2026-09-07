export function normalizeInternalText(input: string): string {
  return stripBom(input)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\u2028\u2029]/g, '\n')
    .replace(/\t/g, '   ');
}

/**
 * Every character normalizeInternalText would rewrite, and nothing else. A
 * BOM is only stripped at offset 0, so it is deliberately absent here and
 * handled by the offset check in isCanonicalInternalText.
 */
const NON_CANONICAL_CHARS = /[\r\t\u2028\u2029]/;

/**
 * True exactly when normalizeInternalText(input) === input -- i.e. when the
 * text is already in the app's canonical internal form.
 *
 * Exists so canonicality can be *enforced at ingress and then assumed*,
 * rather than re-established defensively on every read. A single native
 * regex scan with no allocation is what makes that affordable at the one
 * place it has to run (CM6Editor.tsx's canonical-text transaction filter);
 * normalizeInternalText itself runs four passes and allocates an
 * intermediate string per pass, so calling it "just in case" on a hot path
 * costs the whole document per keystroke to produce, almost always, a
 * character-for-character copy of its own input.
 *
 * `offset` is where `input` will land in the document, so the BOM rule --
 * which only applies at the very start of the text -- can be evaluated
 * correctly for an inserted fragment rather than assumed.
 */
export function isCanonicalInternalText(input: string, offset = 0): boolean {
  if (!input) return true;
  if (offset === 0 && input.charCodeAt(0) === 0xfeff) return false;
  return !NON_CANONICAL_CHARS.test(input);
}


function stripBom(input: string): string {
  if (!input) {
    return input;
  }

  return input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
}
