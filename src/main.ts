import { Plugin, Notice, MarkdownView, Platform, setIcon } from "obsidian";
import { AARSettings, DEFAULT_SETTINGS, CODEBLOCK_TYPE, LOCKED_AUDIO_EXTENSION } from "./types";
import { AARSettingTab } from "./settings";
import { AudioRecorder } from "./recorder/audio-recorder";
import { WaveformBuffer } from "./recorder/waveform-analyzer";
import { StatusBarWidget } from "./ui/status-bar-widget";
import { RecordingPanelView, RECORDING_PANEL_VIEW_TYPE } from "./ui/recording-panel-view";
import { registerRecordingCodeBlock } from "./ui/recording-codeblock";
import { registerPlaybackEmbed } from "./ui/playback-embed";
import { AudioEncryptor } from "./encryption/audio-encryptor";
import { AudioFileView, AUDIO_FILE_VIEW_TYPE } from "./ui/audio-file-view";

export default class AdvancedAudioRecorderPlugin extends Plugin {
	settings: AARSettings = DEFAULT_SETTINGS;
	recorder: AudioRecorder | null = null;
	waveformBuffer: WaveformBuffer = new WaveformBuffer();
	statusBarWidget: StatusBarWidget | null = null;
	encryptor: AudioEncryptor | null = null;

	private ribbonIconEl: HTMLElement | null = null;

	/** File path where the recording code block was inserted */
	private recordingSourceFile: string | null = null;
	/** Unique ID for the current recording session (public for code block reconnect) */
	recordingId: string | null = null;

	async onload() {
		await this.loadSettings();

		this.addSettingTab(new AARSettingTab(this.app, this));

		this.statusBarWidget = new StatusBarWidget(this);

		this.encryptor = new AudioEncryptor(this.app);

		// Register the sidebar recording panel
		this.registerView(
			RECORDING_PANEL_VIEW_TYPE,
			(leaf) => new RecordingPanelView(leaf, this)
		);

		// Desktop: ribbon toggles recording directly (original behaviour)
		// Mobile: ribbon opens the sidebar recording panel
		this.ribbonIconEl = this.addRibbonIcon("mic", "Record audio", () => {
			if (Platform.isMobile) {
				this.openRecordingPanel();
			} else {
				this.toggleRecording();
			}
		});

		this.addCommand({
			id: "toggle-recording",
			name: "Toggle recording",
			callback: () => this.toggleRecording(),
		});

		this.addCommand({
			id: "stop-recording",
			name: "Stop recording",
			callback: () => {
				const s = this.recorder?.state;
				if (s === "recording" || s === "paused") this.stopRecording();
			},
		});

		this.addCommand({
			id: "pause-resume-recording",
			name: "Pause / resume recording",
			callback: () => this.togglePause(),
		});

		this.addCommand({
			id: "open-recording-panel",
			name: "Open recording panel",
			callback: () => this.openRecordingPanel(),
		});

		registerRecordingCodeBlock(this);
		registerPlaybackEmbed(this);

		this.registerView(AUDIO_FILE_VIEW_TYPE, (leaf) => new AudioFileView(leaf, this));
		this.registerExtensions([LOCKED_AUDIO_EXTENSION], AUDIO_FILE_VIEW_TYPE);

		// Open supported audio files in our custom view when clicked from the sidebar.
		// We use file-open rather than registerExtensions so that ![[embed]] rendering
		// in markdown notes is not affected.
		this.registerEvent(
			this.app.workspace.on("file-open", async (file) => {
				if (!file || file.extension.toLowerCase() !== "wav") return;
				const leaf = this.app.workspace.getActiveLeaf();
				if (!leaf || leaf.view.getViewType() === AUDIO_FILE_VIEW_TYPE) return;
				await leaf.setViewState({
					type: AUDIO_FILE_VIEW_TYPE,
					state: { file: file.path },
				});
			})
		);
	}

	onunload() {
		const s = this.recorder?.state;
		if (s === "recording" || s === "paused") this.recorder?.stop();
		this.statusBarWidget?.destroy();
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	// ─── Recording panel ─────────────────────────────────────────────────────

	async openRecordingPanel() {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(RECORDING_PANEL_VIEW_TYPE);
		if (existing.length > 0) {
			workspace.revealLeaf(existing[0]);
			return;
		}
		const leaf = workspace.getRightLeaf(false);
		await leaf?.setViewState({ type: RECORDING_PANEL_VIEW_TYPE, active: true });
		if (leaf) workspace.revealLeaf(leaf);
	}

	private getRecordingPanel(): RecordingPanelView | null {
		const leaves = this.app.workspace.getLeavesOfType(RECORDING_PANEL_VIEW_TYPE);
		return leaves.length > 0 ? (leaves[0].view as RecordingPanelView) : null;
	}

	// ─── Recording lifecycle ─────────────────────────────────────────────────

	async toggleRecording() {
		const s = this.recorder?.state;
		if (s === "recording" || s === "paused") {
			await this.stopRecording();
		} else {
			await this.startRecording();
		}
	}

	togglePause() {
		if (!this.recorder) return;
		if (this.recorder.state === "recording") {
			this.recorder.pause();
			this.statusBarWidget?.updateState("paused");
			if (Platform.isMobile) this.getRecordingPanel()?.setPanelState("paused");
		} else if (this.recorder.state === "paused") {
			this.recorder.resume();
			this.statusBarWidget?.updateState("recording");
			if (Platform.isMobile) this.getRecordingPanel()?.setPanelState("recording");
		}
	}

	async startRecording() {
		if (this.recorder?.state === "recording") {
			new Notice("Already recording");
			return;
		}

		try {
			this.recorder = new AudioRecorder(this.settings);
			this.waveformBuffer.reset();
			this.recordingId = `rec-${Date.now()}`;

			this.recorder.on("amplitude", (value: number) => {
				this.waveformBuffer.push(value);
			});

			this.recorder.on("duration", (seconds: number) => {
				this.statusBarWidget?.updateDuration(seconds);
				if (Platform.isMobile) this.getRecordingPanel()?.updateDuration(seconds);
			});

			this.recorder.on("error", (error: Error) => {
				new Notice(`Recording error: ${error.message}`);
				this.statusBarWidget?.hide();
				if (Platform.isMobile) {
					this.getRecordingPanel()?.setPanelState("idle");
					if (this.ribbonIconEl) setIcon(this.ribbonIconEl, "mic");
				}
			});

			await this.recorder.start();

			this.statusBarWidget?.show();
			if (Platform.isMobile) {
				this.getRecordingPanel()?.setPanelState("recording");
				if (this.ribbonIconEl) setIcon(this.ribbonIconEl, "square");
			}
			this.insertRecordingCodeBlock();

			new Notice("Recording started");
		} catch (e) {
			new Notice(`Failed to start recording: ${(e as Error).message}`);
			this.recorder = null;
		}
	}

	async stopRecording() {
		const s = this.recorder?.state;
		if (!this.recorder || (s !== "recording" && s !== "paused")) return;

		// Track before clearing, so we know if an auto-embed happened
		const hadCodeBlock = !!this.recordingSourceFile;

		try {
			const blob = await this.recorder.stop();
			this.statusBarWidget?.hide();

			const filePath = await this.saveRecording(blob);
			this.replaceRecordingCodeBlock(filePath);

			if (Platform.isMobile) {
				// Show embed button only when the code block wasn't auto-inserted
				this.getRecordingPanel()?.setPanelState("saved", filePath, !hadCodeBlock);
				if (this.ribbonIconEl) setIcon(this.ribbonIconEl, "mic");
			}

			new Notice("Recording saved");
		} catch (e) {
			new Notice(`Failed to save recording: ${(e as Error).message}`);
			if (Platform.isMobile) {
				this.getRecordingPanel()?.setPanelState("idle");
				if (this.ribbonIconEl) setIcon(this.ribbonIconEl, "mic");
			}
		} finally {
			this.recorder = null;
			this.recordingId = null;
			this.recordingSourceFile = null;
		}
	}

	private insertRecordingCodeBlock() {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view || view.getMode() !== "source") {
			this.recordingSourceFile = null;
			return;
		}

		const editor = view.editor;
		const cursor = editor.getCursor();
		const id = this.recordingId;
		// Build the block with a blank line after so the cursor can sit below it
		const codeBlock = `\n\`\`\`${CODEBLOCK_TYPE}\n{"id":"${id}"}\n\`\`\`\n\n`;

		editor.replaceRange(codeBlock, cursor);

		// In live preview, CM6 only renders a code block when the cursor is OUTSIDE it.
		// Move the cursor to the blank line after the block so it renders immediately.
		const newLine = cursor.line + 5; // \n + opening``` + json + closing``` + \n = 5 lines
		editor.setCursor({ line: Math.min(newLine, editor.lineCount() - 1), ch: 0 });

		this.recordingSourceFile = view.file?.path ?? null;
	}

	private replaceRecordingCodeBlock(savedFilePath: string) {
		if (!this.recordingSourceFile || !this.recordingId) return;

		const fileName = savedFilePath.split("/").pop() ?? savedFilePath;
		const embedLink = `![[${fileName}]]`;

		const leaves = this.app.workspace.getLeavesOfType("markdown");
		for (const leaf of leaves) {
			const view = leaf.view;
			if (!(view instanceof MarkdownView)) continue;
			if (view.file?.path !== this.recordingSourceFile) continue;

			const editor = view.editor;
			const content = editor.getValue();
			const searchId = `{"id":"${this.recordingId}"}`;
			const idx = content.indexOf(searchId);
			if (idx === -1) continue;

			const beforeBlock = content.lastIndexOf("```" + CODEBLOCK_TYPE, idx);
			const afterBlock = content.indexOf("```", idx + searchId.length);
			if (beforeBlock === -1 || afterBlock === -1) continue;

			const startOffset =
				beforeBlock > 0 && content[beforeBlock - 1] === "\n"
					? beforeBlock - 1
					: beforeBlock;
			const endOffset =
				afterBlock + 3 + (content[afterBlock + 3] === "\n" ? 1 : 0);

			const startPos = editor.offsetToPos(startOffset);
			const endPos = editor.offsetToPos(endOffset);

			editor.replaceRange(embedLink, startPos, endPos);
			return;
		}
	}

	private async saveRecording(blob: Blob): Promise<string> {
		const folder = this.settings.recordingFolder;

		if (!this.app.vault.getAbstractFileByPath(folder)) {
			await this.app.vault.createFolder(folder);
		}

		const fileName = this.generateFileName();

		if (this.settings.encryptRecordings) {
			const arrayBuffer = await blob.arrayBuffer();
			const filePath = `${folder}/${fileName}.${LOCKED_AUDIO_EXTENSION}`;
			await this.encryptor!.saveEncrypted(arrayBuffer, blob.type, filePath);
			return filePath;
		} else {
			const extension = this.getExtensionForMime(this.settings.mimeType);
			const filePath = `${folder}/${fileName}.${extension}`;
			const arrayBuffer = await blob.arrayBuffer();
			await this.app.vault.createBinary(filePath, arrayBuffer);
			return filePath;
		}
	}

	private generateFileName(): string {
		const now = new Date();
		return this.settings.fileNamePattern
			.replace("YYYY", String(now.getFullYear()))
			.replace("MM", String(now.getMonth() + 1).padStart(2, "0"))
			.replace("DD", String(now.getDate()).padStart(2, "0"))
			.replace("HH", String(now.getHours()).padStart(2, "0"))
			.replace("mm", String(now.getMinutes()).padStart(2, "0"))
			.replace("ss", String(now.getSeconds()).padStart(2, "0"));
	}

	private getExtensionForMime(mime: string): string {
		if (mime.startsWith("audio/webm")) return "webm";
		if (mime.startsWith("audio/ogg")) return "ogg";
		if (mime.startsWith("audio/mp4")) return "m4a";
		return "webm";
	}
}
