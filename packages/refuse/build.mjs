// Bundelt drie dingen:
//  1. dist/inpage.js  — de motor (finder + keywords + banner-structure uit
//     ../../src/lib/autoclick) als IIFE die window.__bannerbyeRefuse zet.
//  2. dist/init.js    — het document_start-script: TCF-weigerstring + GPC.
//  3. dist/index.js + dist/mcp.js — de Node-API, met 1 en 2 als strings
//     ingebakken (geen runtime-bestandslezen, werkt ook gebundeld).
import { build } from 'esbuild';
import { readFileSync, mkdirSync } from 'node:fs';

mkdirSync('dist', { recursive: true });

const browserCommon = {
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2020'],
  minify: false,
  legalComments: 'none',
  define: { 'import.meta.env.BROWSER': '"library"' },
};

await build({ ...browserCommon, entryPoints: ['src/inpage.ts'], outfile: 'dist/inpage.js' });
await build({ ...browserCommon, entryPoints: ['src/init.ts'], outfile: 'dist/init.js' });

const inpage = readFileSync('dist/inpage.js', 'utf8');
const init = readFileSync('dist/init.js', 'utf8');

const nodeCommon = {
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: ['node20'],
  external: ['playwright', 'puppeteer', '@modelcontextprotocol/sdk', '@modelcontextprotocol/sdk/*', 'zod'],
  define: {
    __BB_INPAGE_SOURCE__: JSON.stringify(inpage),
    __BB_INIT_SOURCE__: JSON.stringify(init),
  },
};

await build({ ...nodeCommon, entryPoints: ['src/index.ts'], outfile: 'dist/index.js' });
await build({ ...nodeCommon, entryPoints: ['src/mcp.ts'], outfile: 'dist/mcp.js', banner: { js: '#!/usr/bin/env node' } });
console.log('built dist/{inpage,init,index,mcp}.js');
