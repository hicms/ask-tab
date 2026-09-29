/** Insert clipboard text locally without handing paste back to the browser UI. */
const insertPastedText = (textarea: HTMLTextAreaElement, text: string): string => {
  const value = textarea.value;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const normalized = text.replace(/\r\n?/g, '\n');

  textarea.focus({ preventScroll: true });

  // insertText keeps the browser's undo history. Directly assigning a controlled
  // textarea's value would lose that history. Some engines cannot run the
  // command inside paste, so retain a selection-aware fallback.
  let inserted = false;
  try {
    inserted = textarea.ownerDocument.execCommand('insertText', false, normalized);
  } catch {
    // Unsupported or nested editing commands fall back below.
  }
  if (!inserted && textarea.value === value) {
    textarea.setRangeText(normalized, start, end, 'end');
  }

  return textarea.value;
};

export { insertPastedText };
