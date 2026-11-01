const encoder = new TextEncoder();
const decoder = new TextDecoder();

const VERSION = 2;
const LEGACY_VERSION = 1;
const NOTE_VERSION = 1;
const KDF_NAME = 'PBKDF2-SHA256';
const KDF_ITERATIONS = 600000;
const MIN_ITERATIONS = 100000;
const MAX_ITERATIONS = 5000000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const KEY_BYTES = 32;
const LEGACY_CHECK_TEXT = 'start-notes-vault-v1';
const LEGACY_CHECK_AAD = 'vault-check';
const PASSWORD_AAD = 'vault-key:password';
const PASSKEY_AAD = 'vault-key:passkey:';
const PASSKEY_INFO = 'start-notes-passkey-kek';
const PASSKEY_TIMEOUT = 60000;

function toBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunk = 0x8000;

    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }

    return btoa(binary);
}

function fromBase64(str) {
    const binary = atob(str);
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }

    return bytes;
}

function toBase64Url(buffer) {
    return toBase64(buffer).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(str) {
    const base = str.replace(/-/g, '+').replace(/_/g, '/');
    return fromBase64(base + '='.repeat((4 - base.length % 4) % 4));
}

function randomBytes(length) {
    return crypto.getRandomValues(new Uint8Array(length));
}

async function passwordBits(password, salt, iterations) {
    const material = await crypto.subtle.importKey(
        'raw',
        encoder.encode(String(password).normalize('NFKC')),
        'PBKDF2',
        false,
        ['deriveBits']
    );

    const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
        material,
        KEY_BYTES * 8
    );

    return new Uint8Array(bits);
}

function importAesKey(raw, extractable = false) {
    return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, extractable, ['encrypt', 'decrypt']);
}

async function passwordKek(password, salt, iterations) {
    return importAesKey(await passwordBits(password, salt, iterations));
}

async function passkeyKek(prfOutput, salt) {
    const material = await crypto.subtle.importKey('raw', prfOutput, 'HKDF', false, ['deriveKey']);

    return crypto.subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt, info: encoder.encode(PASSKEY_INFO) },
        material,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

async function wrapRaw(kek, raw, aad) {
    const iv = randomBytes(IV_BYTES);

    const data = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: encoder.encode(aad) },
        kek,
        raw
    );

    return { iv: toBase64(iv), data: toBase64(data) };
}

async function unwrapRaw(kek, box, aad) {
    const raw = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: fromBase64(box.iv), additionalData: encoder.encode(aad) },
        kek,
        fromBase64(box.data)
    );

    return new Uint8Array(raw);
}

async function exportRaw(key) {
    return new Uint8Array(await crypto.subtle.exportKey('raw', key));
}

function checkKdf(meta) {
    if (
        meta.kdf !== KDF_NAME ||
        !meta.salt ||
        !Number.isInteger(meta.iterations) ||
        meta.iterations < MIN_ITERATIONS ||
        meta.iterations > MAX_ITERATIONS
    ) {
        throw new Error('vault: bad meta');
    }
}

async function buildMeta(raw, password, base = {}) {
    const salt = randomBytes(SALT_BYTES);
    const kek = await passwordKek(password, salt, KDF_ITERATIONS);

    return {
        passkeys: [],
        ...base,
        v: VERSION,
        kdf: KDF_NAME,
        iterations: KDF_ITERATIONS,
        salt: toBase64(salt),
        password: await wrapRaw(kek, raw, PASSWORD_AAD)
    };
}

export async function encryptJSON(key, value, aad = '') {
    const iv = randomBytes(IV_BYTES);

    const data = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: encoder.encode(String(aad)) },
        key,
        encoder.encode(JSON.stringify(value))
    );

    return { v: NOTE_VERSION, iv: toBase64(iv), data: toBase64(data) };
}

export async function decryptJSON(key, payload, aad = '') {
    if (!payload || payload.v !== NOTE_VERSION || !payload.iv || !payload.data) {
        throw new Error('vault: bad payload');
    }

    const plain = await crypto.subtle.decrypt(
        {
            name: 'AES-GCM',
            iv: fromBase64(payload.iv),
            additionalData: encoder.encode(String(aad))
        },
        key,
        fromBase64(payload.data)
    );

    return JSON.parse(decoder.decode(plain));
}

export async function createVault(password) {
    const raw = randomBytes(KEY_BYTES);

    return {
        meta: await buildMeta(raw, password),
        key: await importAesKey(raw, true)
    };
}

export async function unlockVault(password, meta) {
    if (!meta || (meta.v !== VERSION && meta.v !== LEGACY_VERSION)) {
        throw new Error('vault: bad meta');
    }

    checkKdf(meta);

    if (meta.v === LEGACY_VERSION) {
        if (!meta.check) {
            throw new Error('vault: bad meta');
        }

        const raw = await passwordBits(password, fromBase64(meta.salt), meta.iterations);
        const key = await importAesKey(raw, true);

        try {
            const result = await decryptJSON(key, meta.check, LEGACY_CHECK_AAD);
            if (!result || result.check !== LEGACY_CHECK_TEXT) {
                return null;
            }
        } catch (error) {
            return null;
        }

        return { key, upgradedMeta: await buildMeta(raw, password) };
    }

    if (!meta.password) {
        throw new Error('vault: bad meta');
    }

    const kek = await passwordKek(password, fromBase64(meta.salt), meta.iterations);

    try {
        const raw = await unwrapRaw(kek, meta.password, PASSWORD_AAD);
        return { key: await importAesKey(raw, true) };
    } catch (error) {
        return null;
    }
}

export async function changeVaultPassword(meta, key, password) {
    const { check, ...rest } = meta;
    return buildMeta(await exportRaw(key), password, rest);
}

function validRpHost() {
    const host = location.hostname;
    return host === 'localhost' || host.endsWith('.localhost') ||
        (host.includes('.') && !/^[\d.]+$/.test(host) && !host.includes(':'));
}

export function passkeysAvailable() {
    return !!(window.isSecureContext && window.PublicKeyCredential && navigator.credentials && validRpHost());
}

export async function passkeyPrfSupport() {
    if (!passkeysAvailable()) {
        return false;
    }

    try {
        if (typeof PublicKeyCredential.getClientCapabilities === 'function') {
            const caps = await PublicKeyCredential.getClientCapabilities();
            if (caps && caps['extension:prf'] === false) {
                return false;
            }
        }
    } catch (error) {
        return true;
    }

    return true;
}

function prfOutput(credential) {
    const results = credential.getClientExtensionResults();
    return results && results.prf && results.prf.results ? results.prf.results.first : null;
}

function unsupported() {
    return new Error('vault: prf unsupported');
}

function deviceLabel() {
    const ua = navigator.userAgent;

    if (/iPhone/.test(ua)) return 'iPhone';
    if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
    if (/Android/.test(ua)) return 'Android';
    if (/Macintosh/.test(ua)) return 'Mac';
    if (/Windows/.test(ua)) return 'Windows';
    if (/CrOS/.test(ua)) return 'ChromeOS';
    if (/Linux/.test(ua)) return 'Linux';

    return 'Устройство';
}

export async function addVaultPasskey(meta, key, user) {
    if (!meta || meta.v !== VERSION) {
        throw new Error('vault: bad meta');
    }

    const raw = await exportRaw(key);
    const prfSalt = meta.prfSalt ? fromBase64(meta.prfSalt) : randomBytes(KEY_BYTES);
    const passkeys = Array.isArray(meta.passkeys) ? meta.passkeys : [];

    const credential = await navigator.credentials.create({
        publicKey: {
            rp: { name: 'codeq notes' },
            user: {
                id: encoder.encode(String(user.id)).slice(0, 64),
                name: user.name,
                displayName: user.displayName
            },
            challenge: randomBytes(32),
            pubKeyCredParams: [
                { type: 'public-key', alg: -7 },
                { type: 'public-key', alg: -257 }
            ],
            authenticatorSelection: {
                residentKey: 'preferred',
                userVerification: 'required'
            },
            excludeCredentials: passkeys.map(p => ({ type: 'public-key', id: fromBase64Url(p.id) })),
            timeout: PASSKEY_TIMEOUT,
            extensions: { prf: { eval: { first: prfSalt } } }
        }
    });

    const prf = credential.getClientExtensionResults().prf;
    if (!prf || prf.enabled === false) {
        throw unsupported();
    }

    let output = prfOutput(credential);

    if (!output) {
        const assertion = await navigator.credentials.get({
            publicKey: {
                challenge: randomBytes(32),
                allowCredentials: [{ type: 'public-key', id: credential.rawId }],
                userVerification: 'required',
                timeout: PASSKEY_TIMEOUT,
                extensions: { prf: { eval: { first: prfSalt } } }
            }
        });
        output = prfOutput(assertion);
    }

    if (!output) {
        throw unsupported();
    }

    const id = toBase64Url(credential.rawId);
    const kek = await passkeyKek(output, prfSalt);

    return {
        ...meta,
        prfSalt: toBase64(prfSalt),
        passkeys: [
            ...passkeys,
            {
                id,
                label: deviceLabel(),
                createdAt: Date.now(),
                ...(await wrapRaw(kek, raw, PASSKEY_AAD + id))
            }
        ]
    };
}

export async function unlockVaultWithPasskey(meta) {
    if (!meta || meta.v !== VERSION || !meta.prfSalt || !Array.isArray(meta.passkeys) || !meta.passkeys.length) {
        throw new Error('vault: bad meta');
    }

    const prfSalt = fromBase64(meta.prfSalt);

    const assertion = await navigator.credentials.get({
        publicKey: {
            challenge: randomBytes(32),
            allowCredentials: meta.passkeys.map(p => ({ type: 'public-key', id: fromBase64Url(p.id) })),
            userVerification: 'required',
            timeout: PASSKEY_TIMEOUT,
            extensions: { prf: { eval: { first: prfSalt } } }
        }
    });

    const output = prfOutput(assertion);
    if (!output) {
        throw unsupported();
    }

    const id = toBase64Url(assertion.rawId);
    const entry = meta.passkeys.find(p => p.id === id);
    if (!entry) {
        throw new Error('vault: unknown passkey');
    }

    const kek = await passkeyKek(output, prfSalt);
    const raw = await unwrapRaw(kek, entry, PASSKEY_AAD + id);

    return importAesKey(raw, true);
}

export function removeVaultPasskey(meta, id) {
    return {
        ...meta,
        passkeys: (meta.passkeys || []).filter(p => p.id !== id)
    };
}