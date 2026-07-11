import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export function decodeSessionKey(encoded: string): Buffer {
	const key = Buffer.from(encoded, 'base64');
	if (key.length !== 32)
		throw new Error('SESSION_ENCRYPTION_KEY must be 32 bytes encoded as base64');
	return key;
}

export function encryptJson(value: unknown, key: Buffer): string {
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', key, iv);
	const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
	return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64url')).join('.');
}

export function decryptJson<T>(value: string, key: Buffer): T {
	const parts = value.split('.');
	if (parts.length !== 3) throw new Error('Invalid encrypted session payload');
	const [iv, tag, ciphertext] = parts.map((part) => Buffer.from(part, 'base64url'));
	const decipher = createDecipheriv('aes-256-gcm', key, iv);
	decipher.setAuthTag(tag);
	return JSON.parse(
		Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
	) as T;
}
