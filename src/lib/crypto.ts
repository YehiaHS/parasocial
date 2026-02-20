const ALGO = 'AES-GCM';
const KEY_NAME = 'parasocial-mem-key';

export async function getOrCreateKey(): Promise<CryptoKey> {
    const stored = localStorage.getItem(KEY_NAME);
    if (stored) {
        const rawKey = Uint8Array.from(atob(stored), c => c.charCodeAt(0));
        return crypto.subtle.importKey('raw', rawKey, ALGO, true, ['encrypt', 'decrypt']);
    }
    const key = await crypto.subtle.generateKey(
        { name: ALGO, length: 256 },
        true,
        ['encrypt', 'decrypt']
    );
    const exported = await crypto.subtle.exportKey('raw', key);
    const exportedStr = btoa(String.fromCharCode(...new Uint8Array(exported)));
    localStorage.setItem(KEY_NAME, exportedStr);
    return key;
}

export async function encryptData(data: string, key: CryptoKey): Promise<{ encrypted: ArrayBuffer, iv: Uint8Array }> {
    const enc = new TextEncoder();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
        { name: ALGO, iv },
        key,
        enc.encode(data)
    );
    return { encrypted, iv };
}

export async function decryptData(encrypted: ArrayBuffer, iv: Uint8Array, key: CryptoKey): Promise<string> {
    const dec = new TextDecoder();
    const decrypted = await crypto.subtle.decrypt(
        { name: ALGO, iv },
        key,
        encrypted
    );
    return dec.decode(decrypted);
}
