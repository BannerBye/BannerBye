/**
 * Hostname-helpers. Bewust simpel: we werken met "host" in
 * de eTLD+1-zin (bijv. "example.com"), niet met volledige URLs.
 *
 * Reden: gebruiker pauzeert "deze site", niet "deze pagina".
 */

/**
 * Normaliseer een URL of hostname naar een schone hostname zonder www.
 * Geeft null bij ongeldige input — caller moet dat afvangen.
 */
export function normalizeHost(input: string): string | null {
  try {
    let host = input;
    // Als het er als URL uitziet, parse het als URL
    if (input.includes('://')) {
      host = new URL(input).hostname;
    }
    host = host.toLowerCase().trim();
    if (!host) return null;
    // Strip leading www.
    if (host.startsWith('www.')) {
      host = host.slice(4);
    }
    return host;
  } catch {
    return null;
  }
}

/**
 * Check of een hostname in een lijst van gepauzeerde sites staat.
 * Match is exact op genormaliseerde host.
 */
export function isHostPaused(host: string, pausedSites: string[]): boolean {
  const normalized = normalizeHost(host);
  if (!normalized) return false;
  return pausedSites.includes(normalized);
}
