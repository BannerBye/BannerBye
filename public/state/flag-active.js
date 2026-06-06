// BannerBye flag-setter — actief op niet-gepauzeerde hosts.
// Wordt dynamisch geregistreerd door background.ts via
// chrome.scripting.registerContentScripts. Runt in MAIN world,
// document_start, vóór TCF/CMP/GPC content scripts hun main() doen.
window.__bannerbyeState = 'active';
