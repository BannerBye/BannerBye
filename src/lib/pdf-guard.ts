/**
 * PDF-document-guard (v0.3.1 hotfix).
 *
 * De excludeMatches-lijsten op de content scripts vangen alleen URL's die
 * herkenbaar naar een PDF wijzen (*.pdf, *PdfViewer*, ...). PDF's die vanaf
 * een extensieloze URL geserveerd worden (bijv. /api/document/4711 met
 * Content-Type: application/pdf) glippen daar doorheen. Chrome rendert zo'n
 * response in de ingebouwde PDF-viewer; content-script-DOM-manipulatie op
 * document_start (zoals prehide's <style>-injectie) kan die viewer breken.
 *
 * Deze runtime-check vangt élk PDF-document, ongeacht de URL-vorm.
 * `document.contentType` is beschikbaar vanaf document_start in Chrome,
 * Firefox en Safari.
 */
export function isPdfDocument(): boolean {
  try {
    const t = (document.contentType || '').toLowerCase();
    return t === 'application/pdf' || t === 'application/x-google-chrome-pdf';
  } catch {
    return false;
  }
}
