const encoder = new TextEncoder();
const decoder = new TextDecoder();

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

/**
 * Encrypts broker session tokens at rest (AES-256-GCM), with a key derived
 * from a deployment secret, so a copy of the database alone does not open
 * anyone's broker account. A token that no longer decrypts (the secret was
 * rotated, or the value was altered) reads as null, which means "log in again".
 */
export class TokenCipher {
  private constructor(private readonly key: CryptoKey) {}

  static async fromSecret(secret: string): Promise<TokenCipher> {
    const material = await crypto.subtle.importKey('raw', encoder.encode(secret), 'HKDF', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: encoder.encode('folio'),
        info: encoder.encode('broker-session-tokens-v1'),
      },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
    return new TokenCipher(key);
  }

  async encrypt(plain: string): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const sealed = new Uint8Array(
      await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, this.key, encoder.encode(plain)),
    );
    const out = new Uint8Array(iv.length + sealed.length);
    out.set(iv);
    out.set(sealed, iv.length);
    return toBase64(out);
  }

  async decrypt(sealed: string): Promise<string | null> {
    try {
      const bytes = fromBase64(sealed);
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, this.key, bytes.slice(12));
      return decoder.decode(plain);
    } catch {
      return null;
    }
  }
}
