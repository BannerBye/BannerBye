/**
 * BitWriter — schrijft bit-velden in een lineaire buffer en exporteert
 * naar base64url. Gebruikt voor het opbouwen van TCF v2.2 TC-strings.
 *
 * Het TCF-formaat is een aaneengeregen reeks bit-velden van variabele
 * lengte (6, 12, 16, 24, 36 bits). We accumuleren bits in een array
 * en encoderen pas op het einde naar base64url. Dat is iets minder
 * efficiënt dan in-place byte-manipulatie, maar veel leesbaarder en
 * maakt off-by-one-fouten direct zichtbaar.
 *
 * Spec: zie tcstring.ts. Alle multi-bit velden zijn unsigned en
 * worden most-significant-bit-first geschreven.
 */
export class BitWriter {
  /** Eén entry per bit; 0 of 1. */
  private readonly bits: number[] = [];

  /**
   * Schrijft een unsigned integer in N bits (MSB first).
   * Validatie: value moet binnen het bereik [0, 2^bitLength) liggen.
   */
  writeNumber(value: number, bitLength: number): void {
    if (!Number.isInteger(value) || !Number.isInteger(bitLength)) {
      throw new TypeError(
        `writeNumber: value (${value}) and bitLength (${bitLength}) must be integers`,
      );
    }
    if (bitLength < 1 || bitLength > 32) {
      throw new RangeError(`writeNumber: bitLength must be 1..32, got ${bitLength}`);
    }
    if (value < 0 || value >= 2 ** bitLength) {
      throw new RangeError(
        `writeNumber: value ${value} doesn't fit in ${bitLength} bits`,
      );
    }
    for (let i = bitLength - 1; i >= 0; i--) {
      this.bits.push((value >>> i) & 1);
    }
  }

  /** Schrijft een boolean als 1 bit. */
  writeBool(value: boolean): void {
    this.bits.push(value ? 1 : 0);
  }

  /**
   * Schrijft een 2-letterige ISO-code (bijv. "EN", "NL") als 12 bits:
   * 6 bits per letter, met A=0 t/m Z=25.
   *
   * Gebruikt voor `consentLanguage` en `publisherCC` in het TCF-formaat.
   */
  writeIsoLetters(code: string): void {
    if (code.length !== 2) {
      throw new RangeError(`writeIsoLetters: code must be exactly 2 chars, got "${code}"`);
    }
    const upper = code.toUpperCase();
    for (const char of upper) {
      const idx = char.charCodeAt(0) - 'A'.charCodeAt(0);
      if (idx < 0 || idx > 25) {
        throw new RangeError(`writeIsoLetters: non-letter character in "${code}"`);
      }
      this.writeNumber(idx, 6);
    }
  }

  /**
   * Schrijft een tijdstempel als 36-bit deciseconden sinds Unix epoch
   * (TCF-spec gebruikt deciseconden = ms / 100). 36 bits is groot
   * genoeg om jaartallen tot ~4147 op te slaan.
   *
   * We splitsen in twee 18-bits-helften om JS' 32-bit integer-grens
   * voor bitshifts te omzeilen.
   */
  writeDeciseconds(epochMs: number): void {
    const deciseconds = Math.floor(epochMs / 100);
    if (deciseconds < 0 || deciseconds >= 2 ** 36) {
      throw new RangeError(`writeDeciseconds: ${deciseconds} out of 36-bit range`);
    }
    const high = Math.floor(deciseconds / 2 ** 18);
    const low = deciseconds % 2 ** 18;
    this.writeNumber(high, 18);
    this.writeNumber(low, 18);
  }

  /** Aantal bits dat tot nu toe is geschreven. */
  get length(): number {
    return this.bits.length;
  }

  /**
   * Pad de bits naar een veelvoud van 8 (met 0-bits) en
   * pak ze als Uint8Array. De TCF-spec staat zero-padding toe
   * — parsers ignoreren bits voorbij de bekende veldlengtes.
   */
  toBytes(): Uint8Array {
    const padded = this.bits.slice();
    while (padded.length % 8 !== 0) {
      padded.push(0);
    }
    const bytes = new Uint8Array(padded.length / 8);
    for (let i = 0; i < bytes.length; i++) {
      let byte = 0;
      for (let j = 0; j < 8; j++) {
        byte = (byte << 1) | padded[i * 8 + j]!;
      }
      bytes[i] = byte;
    }
    return bytes;
  }

  /**
   * Geeft de buffer terug als base64url-encoded string (RFC 4648 §5),
   * zonder padding. Dit is het TCF-formaat zoals het in `__tcfapi`
   * en in TCF-cookies verschijnt.
   *
   * Werkt zowel in browser (`btoa`) als in Node 22+ (`Buffer`).
   */
  toBase64Url(): string {
    const bytes = this.toBytes();
    let base64: string;

    if (typeof btoa === 'function') {
      // Browser-pad. btoa neemt een binary string (één char per byte).
      let binary = '';
      for (const byte of bytes) {
        binary += String.fromCharCode(byte);
      }
      base64 = btoa(binary);
    } else if (
      typeof globalThis !== 'undefined' &&
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      typeof (globalThis as any).Buffer !== 'undefined'
    ) {
      // Node.js-pad.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      base64 = (globalThis as any).Buffer.from(bytes).toString('base64');
    } else {
      throw new Error('BitWriter.toBase64Url: no btoa or Buffer available');
    }

    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
}
