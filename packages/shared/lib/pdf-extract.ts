/**
 * Extract text content from a PDF file.
 *
 * Uses dynamic import so pdfjs-dist is only loaded when actually needed,
 * avoiding ESM/CJS interop issues during Vite config loading.
 */
const extractPdfText = async (data: ArrayBuffer): Promise<string> => {
  const pdfjsLib = await import('pdfjs-dist');
  // Handle both ESM named exports and CJS default interop
  const lib = 'default' in pdfjsLib ? (pdfjsLib.default as typeof pdfjsLib) : pdfjsLib;

  // Disable worker — runs on main thread, fine for text extraction in options page
  lib.GlobalWorkerOptions.workerSrc = '';

  const pdf = await lib.getDocument({ data }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .filter(item => 'str' in item)
      .map(item => (item as { str: string }).str)
      .join(' ');
    if (text.trim()) pages.push(text);
  }
  return pages.join('\n\n');
};

export { extractPdfText };
