import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  srcDir: 'src',
  outDir: '.output',
  // WXT 0.19 resolveert publicDir relatief aan srcDir, dus '../public'
  // stuurt 'm naar de project-root waar onze public/ staat.
  publicDir: '../public',

  manifest: ({ browser, manifestVersion }) => ({
    // v0.3.4 (groeiplan H1.3): naam + omschrijving gelokaliseerd via
    // public/_locales/<lang>/messages.json (11 talen). CWS toont de
    // manifest-description als zoekbare "Summary" per taal — dit is de
    // goedkoopste store-ranking-hefboom (ISDCAC-speelboek).
    //
    // ⚠️ Safari-uitzondering: de Xcode-wrapper registreert de extensie-
    // resources als LOSSE file-references in project.pbxproj (zie
    // bannerbye-safari/wrapper/.../BannerBye.xcodeproj). `_locales/` staat
    // daar niet in en wordt dus NIET meegebundeld. Met __MSG_extName__ zou
    // de extensie in Safari letterlijk "__MSG_extName__" heten. Daarom
    // krijgt de safari-target een literale naam en géén default_locale.
    // Localisatie van de Apple-listing loopt via App Store Connect, niet
    // via het extensie-manifest.
    ...(browser === 'safari'
      ? {
          name: 'BannerBye',
          description: 'Cookie banners, killed. Before they load.',
        }
      : {
          name: '__MSG_extName__',
          description: '__MSG_extDesc__',
          default_locale: 'en',
        }),
    version: '0.3.5',
    permissions: [
      'storage',
      'tabs',
      'activeTab',
      'declarativeNetRequest',
      // v0.2.0: scripting wordt gebruikt voor dynamic content script
      // registration (chrome.scripting.registerContentScripts) — dat is
      // de active-flag bridge (#79). Geen extra permission nodig sinds
      // scripting al gebruikt werd voor onboarding-tab + executeScript.
      'scripting',
      'alarms',
    ],
    host_permissions: ['<all_urls>'],
    icons: {
      '16': 'icon/16.png',
      '32': 'icon/32.png',
      '48': 'icon/48.png',
      '96': 'icon/96.png',
      '128': 'icon/128.png',
    },
    action: {
      default_title: 'BannerBye',
      default_popup: 'popup.html',
    },
    // GPC rule lives in static rule-set (declarative_net_request)
    declarative_net_request: {
      rule_resources: [
        {
          id: 'gpc-headers',
          enabled: true,
          path: 'rules/gpc-headers.json',
        },
      ],
    },
    // Firefox-specific
    ...(browser === 'firefox' && {
      browser_specific_settings: {
        gecko: {
          id: 'bannerbye@bannerbye.com',
          strict_min_version: '115.0',
          // Mozilla AMO sinds 2025: verplichte declaratie van data-collectie.
          // BannerBye collecteert NIETS — settings/cache zijn lokaal en de
          // dagelijkse rules.json fetch is een statische public file zonder
          // identifying info. Dus "none".
          data_collection_permissions: {
            required: ['none'],
          },
        },
        // v0.3.4 (#135/groeiplan H1): Firefox for Android. Sinds Firefox 120
        // is het extensie-ecosysteem op Android open; deze key markeert de
        // extensie als Android-compatibel op AMO. Popup is al mobile-responsive
        // (iOS-werk #99). 121.0 als minimum: eerste stabiele release ná de
        // opening van het ecosysteem.
        gecko_android: {
          strict_min_version: '121.0',
        },
      },
    }),
    // Safari-specific
    ...(browser === 'safari' && {
      browser_specific_settings: {
        safari: {
          strict_min_version: '17.0',
        },
      },
      // iOS Safari ondersteunt geen persistent background pages. WXT genereert
      // standaard `"background": { "scripts": [...] }` (persistent default in MV2).
      // `persistent: false` maakt het een event-page; compatibel met zowel
      // macOS Safari als iOS/iPadOS Safari. Geen functionele impact: onze
      // background.ts gebruikt event-listeners (chrome.alarms, chrome.runtime),
      // niet langlopende state in memory.
      background: {
        scripts: ['background.js'],
        persistent: false,
      },
    }),
  }),

  // Multi-browser builds
  zip: {
    artifactTemplate: '{{name}}-{{version}}-{{browser}}.zip',
  },
});
