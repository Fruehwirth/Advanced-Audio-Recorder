import { MarkdownRenderChild, Notice, Platform, TFile, setIcon } from "obsidian";
import type AdvancedAudioRecorderPlugin from "../main";
import { LOCKED_AUDIO_EXTENSION } from "../types";
import { WaveformRenderer } from "./waveform-renderer";

const AUDIO_EXTENSIONS = ["webm", "ogg", "m4a", "wav", "mp3", LOCKED_AUDIO_EXTENSION];

export function registerPlaybackEmbed(plugin: AdvancedAudioRecorderPlugin) {
	plugin.registerMarkdownPostProcessor((el, ctx) => {
		// In reading mode, audio embeds are children of `el`.
		// In live preview, `el` itself is the internal-embed element.
		const candidates: HTMLElement[] = el.classList.contains("internal-embed")
			? [el]
			: Array.from(el.querySelectorAll<HTMLElement>(".internal-embed"));

		for (const embed of candidates) {
			const src = embed.getAttribute("src") ?? "";
			if (!src) continue;

			const ext = src.split(".").pop()?.toLowerCase() ?? "";
			if (!AUDIO_EXTENSIONS.includes(ext)) continue;

			if (embed.hasClass("aar-embed-root")) continue;

			embed.empty();
			embed.addClass("aar-embed-root");

			const child = new PlaybackEmbedWidget(embed, plugin, src);
			ctx.addChild(child);
		}
	});
}

export class PlaybackEmbedWidget extends MarkdownRenderChild {
	private plugin: AdvancedAudioRecorderPlugin;
	private src: string;
	private audio: HTMLAudioElement | null = null;
	private objectUrl: string | null = null;
	private renderer: WaveformRenderer | null = null;
	private waveformData: Float32Array | null = null;
	private animFrame = 0;
	private isPlaying = false;
	private timeEl: HTMLElement | null = null;
	private playBtn: HTMLElement | null = null;
	private volumeBtn: HTMLElement | null = null;
	private volumeSlider: HTMLInputElement | null = null;
	private lastVolume = 1;
	private isMuted = false;
	private decodedDuration: number | null = null;

	constructor(containerEl: HTMLElement, plugin: AdvancedAudioRecorderPlugin, src: string) {
		super(containerEl);
		this.plugin = plugin;
		this.src = src;
	}

	async onload() {
		const ext = this.src.split(".").pop()?.toLowerCase() ?? "";

		if (ext === LOCKED_AUDIO_EXTENSION) {
			// For encrypted files: try session password silently, else show inline prompt.
			// Never trigger the full-screen modal from an embed.
			const file = this.plugin.app.metadataCache.getFirstLinkpathDest(this.src, "");
			if (file instanceof TFile) {
				const blob = await this.plugin.encryptor!.tryDecryptWithSession(file);
				if (blob) {
					await this.buildPlayer(blob);
					return;
				}
			}
			this.renderLockedPrompt();
			return;
		}

		try {
			const blob = await this.loadAudio();
			await this.buildPlayer(blob);
		} catch {
			this.containerEl.createEl("div", { cls: "aar-playback", text: "Could not load audio" });
		}
	}

	onunload() {
		this.stopAnimation();
		// Remove the guard class so the post-processor can re-initialise this
		// element if Obsidian reuses the same DOM node on the next render.
		this.containerEl.removeClass("aar-embed-root");
		if (this.audio) {
			this.audio.pause();
			this.audio = null;
		}
		if (this.objectUrl) {
			URL.revokeObjectURL(this.objectUrl);
			this.objectUrl = null;
		}
	}

	// ─── Player ──────────────────────────────────────────────────────────────

	private async buildPlayer(blob: Blob) {
		this.containerEl.empty();

		if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
		this.objectUrl = URL.createObjectURL(blob);
		this.audio = new Audio(this.objectUrl);

		const player = this.containerEl.createEl("div", { cls: "aar-playback" });

		// Stop Obsidian's internal-embed click handler from navigating to the file
		player.addEventListener("click", (e) => e.stopPropagation());

		// Play / pause button
		this.playBtn = player.createEl("button", { cls: "aar-play-btn" });
		setIcon(this.playBtn, "play");

		// Waveform (flex-1, seekable)
		const waveWrap = player.createEl("div", { cls: "aar-playback-waveform-wrap" });
		const canvas = waveWrap.createEl("canvas", { cls: "aar-playback-waveform" });

		// Right column: time + volume
		const right = player.createEl("div", { cls: "aar-playback-right" });

		const timeRow = right.createEl("div", { cls: "aar-playback-duration" });

		// Lock toggle: lock icon for encrypted files, lock-open for normal files
		const isLocked = this.src.toLowerCase().endsWith("." + LOCKED_AUDIO_EXTENSION);
		const convertBtn = timeRow.createEl("span", {
			cls: "aar-convert-btn",
			title: isLocked ? "Save as unencrypted audio file" : "Save as encrypted audio file",
		});
		setIcon(convertBtn, isLocked ? "lock" : "lock-open");
		convertBtn.addEventListener("click", () =>
			isLocked ? this.convertToUnlocked(blob) : this.convertToLocked(blob)
		);

		this.timeEl = timeRow.createEl("span", { text: "0:00 / -:--" });

		const volRow = right.createEl("div", { cls: "aar-volume" });
		// Use <span> instead of <button> — has zero native styling to fight against
		this.volumeBtn = volRow.createEl("span", { cls: "aar-volume-btn" });
		setIcon(this.volumeBtn, "volume-2");

		this.volumeSlider = volRow.createEl("input", { cls: "aar-volume-slider" });
		this.volumeSlider.type = "range";
		this.volumeSlider.min = "0";
		this.volumeSlider.max = "1";
		this.volumeSlider.step = "0.01";
		this.volumeSlider.value = "1";

		// ── Waveform: show placeholder immediately, decode in background ──
		requestAnimationFrame(() => {
			this.renderer = new WaveformRenderer(canvas, Platform.isMobile ? 0.5 : 1);
			this.waveformData = new Float32Array(200).fill(0.15);
			this.drawWaveform();

			this.generateWaveform(blob).then(() => {
				// Re-measure the canvas — it may have had zero dimensions on the
				// first rAF if the embed wasn't fully laid out yet.
				this.renderer?.resize();
				this.drawWaveform();
				if (this.decodedDuration && this.timeEl) {
					const cur = this.audio?.currentTime ?? 0;
					this.timeEl.textContent = `${this.formatTime(cur)} / ${this.formatTime(this.decodedDuration)}`;
				}
			});
		});

		// ── Audio events ──
		const updateTime = () => {
			if (!this.audio || !this.timeEl) return;
			const cur = this.audio.currentTime;
			const audioDur = this.audio.duration;
			const dur = isFinite(audioDur) && audioDur > 0 ? audioDur : (this.decodedDuration ?? null);
			this.timeEl.textContent = `${this.formatTime(cur)} / ${dur ? this.formatTime(dur) : "-:--"}`;
		};

		this.audio.addEventListener("durationchange", updateTime);
		this.audio.addEventListener("timeupdate", updateTime);

		this.audio.addEventListener("play", () => {
			this.isPlaying = true;
			if (this.playBtn) { this.playBtn.empty(); setIcon(this.playBtn, "pause"); }
			this.startAnimation();
		});

		this.audio.addEventListener("pause", () => {
			this.isPlaying = false;
			this.stopAnimation();
			if (this.playBtn) { this.playBtn.empty(); setIcon(this.playBtn, "play"); }
		});

		this.audio.addEventListener("ended", () => {
			this.isPlaying = false;
			this.stopAnimation();
			if (this.playBtn) { this.playBtn.empty(); setIcon(this.playBtn, "play"); }
			if (this.renderer && this.waveformData) this.renderer.drawStatic(this.waveformData, 0);
			updateTime();
		});

		// ── Controls ──
		this.playBtn.addEventListener("click", () => {
			if (!this.audio) return;
			this.isPlaying ? this.audio.pause() : this.audio.play();
		});

		waveWrap.addEventListener("click", (e) => {
			if (!this.audio) return;
			// Use decodedDuration as fallback — fresh webm files report Infinity
			const audioDur = this.audio.duration;
			const dur = isFinite(audioDur) && audioDur > 0 ? audioDur : (this.decodedDuration ?? 0);
			if (dur <= 0) return;
			const rect = waveWrap.getBoundingClientRect();
			const progress = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
			this.audio.currentTime = progress * dur;
			this.drawWaveform();
		});

		this.volumeSlider.addEventListener("input", () => {
			if (!this.audio || !this.volumeSlider) return;
			const vol = parseFloat(this.volumeSlider.value);
			this.audio.volume = vol;
			this.isMuted = vol === 0;
			if (vol > 0) this.lastVolume = vol;
			this.updateVolumeIcon();
		});

		this.volumeBtn.addEventListener("click", () => {
			if (!this.audio || !this.volumeSlider) return;
			if (this.isMuted || this.audio.volume === 0) {
				const restore = this.lastVolume > 0 ? this.lastVolume : 1;
				this.audio.volume = restore;
				this.volumeSlider.value = String(restore);
				this.isMuted = false;
			} else {
				this.lastVolume = this.audio.volume;
				this.audio.volume = 0;
				this.volumeSlider.value = "0";
				this.isMuted = true;
			}
			this.updateVolumeIcon();
		});
	}

	// ─── Animation loop ───────────────────────────────────────────────────────

	private startAnimation() {
		this.stopAnimation();
		const tick = () => {
			this.drawWaveform();
			if (this.isPlaying) this.animFrame = requestAnimationFrame(tick);
		};
		this.animFrame = requestAnimationFrame(tick);
	}

	private stopAnimation() {
		if (this.animFrame) {
			cancelAnimationFrame(this.animFrame);
			this.animFrame = 0;
		}
	}

	private drawWaveform() {
		if (!this.renderer || !this.waveformData) return;
		const audio = this.audio;
		const audioDur = audio?.duration ?? 0;
		const dur = isFinite(audioDur) && audioDur > 0 ? audioDur : (this.decodedDuration ?? 0);
		const progress = dur > 0 && audio ? audio.currentTime / dur : 0;
		this.renderer.drawStatic(this.waveformData, progress);
	}

	private updateVolumeIcon() {
		if (!this.volumeBtn || !this.audio) return;
		this.volumeBtn.empty();
		const vol = this.audio.volume;
		const icon = this.isMuted || vol === 0 ? "volume-x" : vol < 0.5 ? "volume-1" : "volume-2";
		setIcon(this.volumeBtn, icon);
	}

	// ─── Locked audio prompt ──────────────────────────────────────────────────

	private renderLockedPrompt() {
		this.containerEl.empty();

		const prompt = this.containerEl.createEl("div", { cls: "aar-playback aar-locked-prompt" });

		// Stop Obsidian from navigating to the file when the prompt is clicked
		prompt.addEventListener("click", (e) => e.stopPropagation());

		const header = prompt.createEl("div", { cls: "aar-locked-prompt-header" });
		const lockIcon = header.createEl("span");
		setIcon(lockIcon, "lock");
		header.createEl("span", { text: "Encrypted audio" });

		const inputRow = prompt.createEl("div", { cls: "aar-locked-prompt-input" });
		const input = inputRow.createEl("input", { type: "password", placeholder: "Password…" });
		const unlockBtn = inputRow.createEl("button", { cls: "mod-cta", text: "Unlock" });

		const doUnlock = async () => {
			const password = input.value;
			if (!password) return;
			try {
				const file = this.plugin.app.metadataCache.getFirstLinkpathDest(this.src, "");
				if (!file || !(file instanceof TFile)) throw new Error("File not found");
				// Pass password directly — skips the full-screen modal entirely
				const blob = await this.plugin.encryptor!.decryptFile(file, password);
				this.containerEl.empty();
				await this.buildPlayer(blob);
			} catch {
				input.value = "";
				input.placeholder = "Wrong password — try again";
				input.addClass("aar-input-error");
				setTimeout(() => input.removeClass("aar-input-error"), 1200);
			}
		};

		unlockBtn.addEventListener("click", doUnlock);
		input.addEventListener("keydown", (e) => { if (e.key === "Enter") doUnlock(); });
	}

	// ─── Convert to unencrypted ───────────────────────────────────────────────

	private async convertToUnlocked(blob: Blob) {
		const file = this.plugin.app.metadataCache.getFirstLinkpathDest(this.src, "");
		if (!(file instanceof TFile)) return;

		const ext = this.mimeToExtension(blob.type);
		const newPath = file.path.replace(/\.[^.]+$/, "") + "." + ext;

		if (this.plugin.app.vault.getAbstractFileByPath(newPath)) {
			new Notice(`File already exists: ${newPath}`);
			return;
		}

		try {
			const buffer = await blob.arrayBuffer();
			await this.plugin.app.vault.modifyBinary(file, buffer);
			await this.plugin.app.fileManager.renameFile(file, newPath);
		} catch {
			new Notice("Failed to save file.");
		}
	}

	private async convertToLocked(blob: Blob) {
		const file = this.plugin.app.metadataCache.getFirstLinkpathDest(this.src, "");
		if (!(file instanceof TFile)) return;

		const newPath = file.path.replace(/\.[^.]+$/, "") + "." + LOCKED_AUDIO_EXTENSION;

		if (this.plugin.app.vault.getAbstractFileByPath(newPath)) {
			new Notice(`File already exists: ${newPath}`);
			return;
		}

		try {
			const buffer = await blob.arrayBuffer();
			const json = await this.plugin.encryptor!.encryptToJson(buffer, blob.type);
			if (!json) return; // user cancelled password prompt
			await this.plugin.app.vault.modify(file, json);
			await this.plugin.app.fileManager.renameFile(file, newPath);
		} catch {
			new Notice("Failed to encrypt file.");
		}
	}

	private mimeToExtension(mimeType: string): string {
		if (mimeType.startsWith("audio/webm")) return "webm";
		if (mimeType.startsWith("audio/ogg")) return "ogg";
		if (mimeType.startsWith("audio/mp4")) return "m4a";
		if (mimeType.startsWith("audio/wav")) return "wav";
		if (mimeType.startsWith("audio/mpeg")) return "mp3";
		return "webm";
	}

	// ─── Helpers ─────────────────────────────────────────────────────────────

	private async loadAudio(): Promise<Blob> {
		const file = this.plugin.app.metadataCache.getFirstLinkpathDest(this.src, "");
		if (!file || !(file instanceof TFile)) throw new Error("File not found");
		const buffer = await this.plugin.app.vault.readBinary(file);
		return new Blob([buffer]);
	}

	private async generateWaveform(blob: Blob): Promise<void> {
		try {
			const arrayBuffer = await blob.arrayBuffer();
			const tmpCtx = new OfflineAudioContext(1, 1, 44100);
			const audioBuffer = await tmpCtx.decodeAudioData(arrayBuffer);

			this.decodedDuration = audioBuffer.duration;

			const raw = audioBuffer.getChannelData(0);
			const barCount = 200;
			const blockSize = Math.max(1, Math.floor(raw.length / barCount));
			const samples = new Float32Array(barCount);

			for (let i = 0; i < barCount; i++) {
				let sum = 0;
				const start = i * blockSize;
				const end = Math.min(start + blockSize, raw.length);
				for (let j = start; j < end; j++) sum += Math.abs(raw[j]);
				samples[i] = sum / (end - start);
			}

			let max = 0;
			for (let i = 0; i < samples.length; i++) if (samples[i] > max) max = samples[i];
			if (max > 0) for (let i = 0; i < samples.length; i++) samples[i] /= max;

			this.waveformData = samples;
		} catch {
			this.waveformData = new Float32Array(200).fill(0.15);
		}
	}

	private formatTime(seconds: number): string {
		if (!isFinite(seconds) || seconds < 0) return "0:00";
		const m = Math.floor(seconds / 60);
		const s = Math.floor(seconds % 60);
		return `${m}:${s.toString().padStart(2, "0")}`;
	}
}
