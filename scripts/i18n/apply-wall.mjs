// Past wall-0412.json toe op alle _locales (popup_ticket_wall, popup_ticket_accept_only, popup_proof_wall).
import fs from 'node:fs';
const src = JSON.parse(fs.readFileSync(new URL('./wall-0412.json', import.meta.url), 'utf8'));
const alias = { en_AU: 'en', en_GB: 'en', en_US: 'en' };
const dir = new URL('../../public/_locales/', import.meta.url);
let n = 0;
for (const loc of fs.readdirSync(dir)) {
  const vals = src[loc] ?? src[alias[loc]];
  if (!vals) { console.warn('geen vertaling voor', loc); continue; }
  const f = new URL(`${loc}/messages.json`, dir);
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  j.popup_ticket_wall = { message: vals[0] };
  j.popup_ticket_accept_only = { message: vals[1] };
  j.popup_proof_wall = { message: vals[2] };
  fs.writeFileSync(f, JSON.stringify(j, null, 2) + '\n');
  n++;
}
console.log('bijgewerkt:', n, 'locales');
