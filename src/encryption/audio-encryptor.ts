import { App, Modal, TFile, Setting } from "obsidian";
import { SessionBridge } from "./session-bridge";
import {
	createLockedAudioFile,
	parseLockedAudioFile,
} from "./locked-audio-format";

/**
 * Self-contained AES-256-GCM encryption/decryption for audio data.
 * Crypto parameters match AFE exactly (PBKDF2-SHA512, 210k iterations)
 * to ensure conceptual compatibility, but the code is independent.
 */
export class AudioEncryptor {
	private app: App;
	readonly bridge: SessionBridge;

	constructor(app: App) {
		this.app = app;
		this.bridge = new SessionBridge(app);
	}

	/**
	 * Encrypt audio data and save as .lockedaudio file.
	 * Never writes unencrypted audio to disk.
	 */
	async saveEncrypted(audioBuffer: ArrayBuffer, mimeType: string, filePath: string): Promise<void> {
		const json = await this.encryptToJson(audioBuffer, mimeType);
		if (!json) throw new Error("Encryption cancelled — no password provided");
		await this.app.vault.create(filePath, json);
	}

	/**
	 * Encrypt audio and return the JSON string without saving to disk.
	 * Returns null if the user cancels the password prompt.
	 */
	async encryptToJson(audioBuffer: ArrayBuffer, mimeType: string): Promise<string | null> {
		const password = await this.getOrPromptPassword();
		if (!password) return null;

		const { ciphertext, iv, salt } = await this.encrypt(new Uint8Array(audioBuffer), password);
		const fileData = createLockedAudioFile(
			uint8ToBase64(ciphertext),
			uint8ToBase64(iv),
			uint8ToBase64(salt),
			mimeType
		);
		return JSON.stringify(fileData, null, 2);
	}

	/**
	 * Try to decrypt using the AFE session password only — no modal, no prompt.
	 * Returns null if no session password is available or decryption fails.
	 */
	async tryDecryptWithSession(file: TFile): Promise<Blob | null> {
		const password = this.bridge.getSessionPassword();
		if (!password) return null;
		try {
			return await this.decryptFile(file, password);
		} catch {
			return null;
		}
	}

	/**
	 * Decrypt a .lockedaudio file. Returns a playable audio Blob.
	 */
	async decryptFile(file: TFile, password?: string): Promise<Blob> {
		const raw = await this.app.vault.read(file);
		const lockedFile = parseLockedAudioFile(raw);

		if (!password) {
			password = this.bridge.getSessionPassword() ?? undefined;
		}
		if (!password) {
			password = (await this.promptPassword()) ?? undefined;
		}
		if (!password) throw new Error("Decryption cancelled");

		const ciphertext = base64ToUint8(lockedFile.data);
		const iv = base64ToUint8(lockedFile.encryption.iv);
		const salt = base64ToUint8(lockedFile.encryption.keyDerivation.salt);
		const decrypted = await this.decrypt(ciphertext, iv, salt, password);
		if (!decrypted) throw new Error("Wrong password or corrupted data");

		// Store password in AFE session for future use
		this.bridge.storeInSession(password);

		const mimeType = lockedFile.audio?.mimeType ?? "audio/webm";
		return new Blob([decrypted.buffer as ArrayBuffer], { type: mimeType });
	}

	private async getOrPromptPassword(): Promise<string | null> {
		// First check AFE session
		const sessionPw = this.bridge.getSessionPassword();
		if (sessionPw) return sessionPw;

		// Prompt user
		const password = await this.promptPassword();
		if (password) {
			// Store in AFE session if available
			this.bridge.storeInSession(password);
		}
		return password;
	}

	private promptPassword(): Promise<string | null> {
		return new Promise((resolve) => {
			const modal = new PasswordModal(this.app, (password) => {
				resolve(password);
			});
			modal.open();
		});
	}

	// --- Crypto implementation (matches AFE's AES-256-GCM + PBKDF2-SHA512) ---

	private async encrypt(
		data: Uint8Array,
		password: string
	): Promise<{ ciphertext: Uint8Array; iv: Uint8Array; salt: Uint8Array }> {
		const iv = crypto.getRandomValues(new Uint8Array(16));
		const salt = crypto.getRandomValues(new Uint8Array(16));
		const key = await this.deriveKey(password, salt);

		const ciphertext = await crypto.subtle.encrypt(
			{ name: "AES-GCM", iv: iv as BufferSource },
			key,
			data.buffer as ArrayBuffer
		);

		return { ciphertext: new Uint8Array(ciphertext), iv, salt };
	}

	private async decrypt(
		ciphertext: Uint8Array,
		iv: Uint8Array,
		salt: Uint8Array,
		password: string
	): Promise<Uint8Array | null> {
		const key = await this.deriveKey(password, salt);

		try {
			const plaintext = await crypto.subtle.decrypt(
				{ name: "AES-GCM", iv: iv as BufferSource },
				key,
				ciphertext.buffer as ArrayBuffer
			);
			return new Uint8Array(plaintext);
		} catch {
			return null; // Wrong password or corrupted
		}
	}

	private async deriveKey(
		password: string,
		salt: Uint8Array
	): Promise<CryptoKey> {
		const encoder = new TextEncoder();
		const encoded = encoder.encode(password);
		const keyMaterial = await crypto.subtle.importKey(
			"raw",
			encoded.buffer as ArrayBuffer,
			"PBKDF2",
			false,
			["deriveKey"]
		);

		return crypto.subtle.deriveKey(
			{
				name: "PBKDF2",
				salt: salt.buffer as ArrayBuffer,
				iterations: 210000,
				hash: "SHA-512",
			},
			keyMaterial,
			{ name: "AES-GCM", length: 256 },
			false,
			["encrypt", "decrypt"]
		);
	}
}

// --- Password Modal ---

class PasswordModal extends Modal {
	private callback: (password: string | null) => void;
	private resolved = false;

	constructor(app: App, callback: (password: string | null) => void) {
		super(app);
		this.callback = callback;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.addClass("aar-password-modal");
		contentEl.createEl("h3", { text: "Enter encryption password" });

		const inputWrap = contentEl.createEl("div", {
			cls: "aar-password-input-wrap",
		});
		const input = inputWrap.createEl("input", {
			type: "password",
			placeholder: "Password",
		});
		input.style.width = "100%";

		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter" && input.value) {
				this.resolved = true;
				this.callback(input.value);
				this.close();
			}
		});

		new Setting(contentEl)
			.addButton((btn) =>
				btn.setButtonText("Confirm").setCta().onClick(() => {
					if (input.value) {
						this.resolved = true;
						this.callback(input.value);
						this.close();
					}
				})
			)
			.addButton((btn) =>
				btn.setButtonText("Cancel").onClick(() => {
					this.close();
				})
			);

		// Focus the input
		setTimeout(() => input.focus(), 50);
	}

	onClose() {
		if (!this.resolved) {
			this.callback(null);
		}
		this.contentEl.empty();
	}
}

// --- Base64 utilities ---

function uint8ToBase64(bytes: Uint8Array): string {
	let binary = "";
	for (let i = 0; i < bytes.length; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary);
}

function base64ToUint8(base64: string): Uint8Array {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}
