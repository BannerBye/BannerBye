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
    name: 'BannerBye',
    description: 'Cookie banners, killed. Before they load.',
    version: '0.2.0',
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
