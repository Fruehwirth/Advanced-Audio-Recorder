/**
 * .lockedaudio JSON file format for encrypted audio recordings.
 *
 * IV and salt are stored as explicit Base64 fields in the JSON so the format
 * is fully self-describing. The data field contains only the AES-GCM ciphertext.
 */

export const LOCKEDAUDIO_FORMAT = "advanced-audio-recorder";
export const LOCKEDAUDIO_VERSION = 1;

export interface LockedAudioFile {
	format: typeof LOCKEDAUDIO_FORMAT;
	version: typeof LOCKEDAUDIO_VERSION;
	audio: {
		/** MIME type of the original audio (e.g. "audio/webm;codecs=opus") */
		mimeType: string;
	};
	encryption: {
		algorithm: "AES-GCM";
		keySize: 256;
		/** Base64-encoded 16-byte IV */
		iv: string;
		keyDerivation: {
			function: "PBKDF2";
			hash: "SHA-512";
			iterations: 210000;
			/** Base64-encoded 16-byte salt */
			salt: string;
		};
	};
	keyType: "password";
	hint: string;
	/** Base64-encoded AES-GCM ciphertext (no IV/salt prefix) */
	data: string;
}

export function createLockedAudioFile(
	ciphertextBase64: string,
	ivBase64: string,
	saltBase64: string,
	mimeType: string,
	hint: string = ""
): LockedAudioFile {
	return {
		format: LOCKEDAUDIO_FORMAT,
		version: LOCKEDAUDIO_VERSION,
		audio: { mimeType },
		encryption: {
			algorithm: "AES-GCM",
			keySize: 256,
			iv: ivBase64,
			keyDerivation: {
				function: "PBKDF2",
				hash: "SHA-512",
				iterations: 210000,
				salt: saltBase64,
			},
		},
		keyType: "password",
		hint,
		data: ciphertextBase64,
	};
}

export function parseLockedAudioFile(json: string): LockedAudioFile {
	const parsed = JSON.parse(json);
	if (parsed.format !== LOCKEDAUDIO_FORMAT) {
		throw new Error(`Unknown format: ${parsed.format}`);
	}
	return parsed as LockedAudioFile;
}
