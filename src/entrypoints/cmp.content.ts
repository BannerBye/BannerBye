/**
 * BannerBye — CMP-handler-dispatcher.
 *
 * Loopt door de geregistreerde CMP-handlers, detecteert welke CMP
 * op deze pagina draait, en past de bijbehorende "no consent"-actie
 * toe. Dit is de tweede verdedigingslaag — onze TCF-stub
 * (`tcf.content.ts`) vangt de standaard `__tcfapi`-route af; deze
 * laag handelt CMP-proprietaire cookies + APIs af voor gevallen
 * waar TCF alleen niet genoeg is.
 *
 * Architectuur:
 *  - Draait in MAIN world zodat we direct met `window.Didomi` etc.
 *    kunnen praten (die zijn alleen op page-context zichtbaar).
 *  - Wacht op `DOMContentLoaded` voor detectie — sommige CMPs
 *    laden hun script asynchroon en zijn op document_start nog
 *    niet zichtbaar.
 *  - Past slechts één handler toe per page-load (eerste match wint).
 *  - Faalt stil — als een handler crasht, gaat de rest gewoon door.
 *
 * Per-site pause: voor v0.1 nog niet geïmplementeerd op deze laag.
 * Achtergrond unregistert content scripts wanneer extensie globaal
 * uit staat. Site-specifieke pause komt in een volgende iteratie.
 */

import { defineContentScript } from 'wxt/sandbox';
import { handlers } from '@/lib/cmp/index.ts';
import { readActiveState } from '@/lib/active-flag.ts';

export default defineContentScript({
  // v0.2.0 (#111): Chrome MV3 → dynamic. Zie tcf.content.ts voor toelichting.
  matches:
    (import.meta as unknown as { env: { BROWSER: string } }).env.BROWSER === 'chrome'
      ? ['https://_bb_runtime_only_.invalid/*']
      : ['<all_urls>'],
  // v0.1.2: skip PDF-viewer routes — zie tcf.content.ts voor toelichting.
  // v0.1.4: enterprise SaaS hosts — zie tcf.content.ts.
  excludeMatches: [
    '*://*/*.pdf',
    '*://*/*.PDF',
    '*://*/*PdfViewer*',
    '*://*/*pdfviewer*',
    '*://*/*PDFViewer*',
    '*://*/*pdf-viewer*',
    '*://*/*PdfViewer.aspx*',
    '*://*/*Viewer.aspx*',
    '*://*/*viewer.aspx*',
    '*://*.exactonline.nl/*',
    '*://*.exactonline.be/*',
    '*://*.exactonline.com/*',
    '*://*.exactonline.co.uk/*',
    '*://*.exactonline.de/*',
    '*://*.exactonline.fr/*',
    '*://*.exactonline.es/*',
  ],
  runAt: 'document_start',
  world: 'MAIN',
  // Alleen main frame — CMP-handlers in subframes zou hetzelfde
  // werk dubbel doen, en sommige handlers (zoals Didomi.notice.hide)
  // raken anders verwarrd over welke notice ze hidden.
  allFrames: false,

  async main() {
    // v0.2.0: vroege exit als BannerBye uit staat of host gepauzeerd is.
    // Zie active-flag bridge in background.ts.
    if (readActiveState() !== 'active') {
      return;
    }

    // Wacht op DOMContentLoaded zodat alle <script>-tags in <head>
    // hun src-attribuut hebben — onze detect() leest die.
    if (document.readyState === 'loading') {
      await new Promise<void>((resolve) => {
        document.addEventListener('DOMContentLoaded', () => resolve(), {
          once: true,
        });
      });
    }

    for (const handler of handlers) {
      let detected = false;
      try {
        detected = handler.detect();
      } catch (err) {
        console.warn(`[BannerBye] CMP detect "${handler.name}" failed:`, err);
        continue;
      }
      if (!detected) continue;

      try {
        await handler.apply();
        // v0.2.0 (#114): rapporteer block voor teller. bridge.content.ts
        // pickt 'bb:cmp-blocked' op en stuurt 'bb:banner-blocked' naar background.
        // Op `document` (niet `window`) want events flowen daar wél cross-world
        // in Chrome MV3 — MAIN ↔ ISOLATED delen document maar hebben aparte
        // window-listeners.
        try {
          document.dispatchEvent(new CustomEvent('bb:cmp-blocked'));
        } catch {
          // CustomEvent faalt zelden — niet kritiek.
        }
      } catch (err) {
        console.warn(`[BannerBye] CMP apply "${handler.name}" failed:`, err);
      }
      // Eerste match wint. Sites gebruiken zelden meerdere CMPs
      // tegelijk; als ze dat wel doen, raden we de meest-zichtbare
      // (= eerste in onze lijst) als primaire.
      return;
    }
  },
});
