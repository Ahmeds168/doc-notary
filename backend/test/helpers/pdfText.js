import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

/** Extract { pages, text, links } from a PDF buffer. Text items are joined with spaces per page; links are URI annotations. */
export async function pdfText(buffer) {
  const task = getDocument({ data: new Uint8Array(buffer), useSystemFonts: false, isEvalSupported: false, verbosity: 0 });
  const pdf = await task.promise;
  const parts = [];
  const links = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    parts.push(content.items.map((item) => item.str).join(" "));
    for (const a of await page.getAnnotations()) if (a.url) links.push(a.url);
  }
  const pages = pdf.numPages;
  await task.destroy();
  return { pages, text: parts.join("\n"), links };
}
