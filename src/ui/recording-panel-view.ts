import { ItemView, WorkspaceLeaf, MarkdownView, Notice, setIcon } from "obsidian";
import type AdvancedAudioRecorderPlugin from "../main";
import { WaveformRenderer } from "./waveform-renderer";

export const RECORDING_PANEL_VIEW_TYPE = "aar-recording-panel";

type PanelState = "idle" | "recording" | "paused" | "saved";

export class RecordingPanelView extends ItemView {
	plugin: AdvancedAudioRecorderPlugin;

	private panelState: PanelState = "idle";
	private savedFilePath: string | null = null;
	private showEmbedBtn = false;

	private renderer: WaveformRenderer | null = null;
	private animFrame = 0;

	private durationEl: HTMLElement | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: AdvancedAudioRecorderPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType() { return RECORDING_PANEL_VIEW_TYPE; }
	getDisplayText() { return "Audio Recorder"; }
	getIcon() { return "mic"; }

	async onOpen() {
		this.render();
	}

	async onClose() {
		this.stopAnimation();
	}

	// ─── State transitions ────────────────────────────────────────────────────

	setPanelState(state: PanelState, savedFilePath?: string, showEmbedBtn?: boolean) {
		this.panelState = state;
		if (savedFilePath !== undefined) this.savedFilePath = savedFilePath;
		if (showEmbedBtn !== undefined) this.showEmbedBtn = showEmbedBtn;
		this.render();
	}

	updateDuration(seconds: number) {
		if (!this.durationEl) return;
		const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
		const ss = String(Math.floor(seconds % 60)).padStart(2, "0");
		this.durationEl.textContent = `${mm}:${ss}`;
	}

	// ─── Rendering ────────────────────────────────────────────────────────────

	private render() {
		this.stopAnimation();
		this.durationEl = null;
		this.renderer = null;

		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("aar-panel");

		switch (this.panelState) {
			case "idle":      this.renderIdle(); break;
			case "recording": this.renderRecording(false); break;
			case "paused":    this.renderRecording(true); break;
			case "saved":     this.renderSaved(); break;
		}
	}

	private renderIdle() {
		const wrap = this.contentEl.createEl("div", { cls: "aar-panel-idle" });

		// Outer pulsing ring → inner record button
		const ring = wrap.createEl("div", { cls: "aar-record-ring" });
		const btn = ring.createEl("button", { cls: "aar-record-btn" });
		setIcon(btn, "mic");
		btn.addEventListener("click", async () => this.plugin.startRecording());

		wrap.createEl("span", { cls: "aar-record-hint", text: "Tap to record" });
	}

	private renderRecording(isPaused: boolean) {
		const { contentEl } = this;

		// Wrap so the waveform can flex-grow between header and buttons
		const wrap = contentEl.createEl("div", { cls: "aar-panel-recording-wrap" });

		// Status row: animated dot · REC label · timer
		const status = wrap.createEl("div", { cls: "aar-panel-rec-status" });
		const dot = status.createEl("span", { cls: "aar-panel-rec-dot" });
		if (isPaused) dot.addClass("aar-panel-rec-dot--paused");
		status.createEl("span", {
			cls: "aar-panel-rec-tag",
			text: isPaused ? "PAUSED" : "REC",
		});
		this.durationEl = status.createEl("span", { cls: "aar-panel-timer", text: "00:00" });

		// Waveform — grows to fill remaining space
		const canvas = wrap.createEl("canvas", { cls: "aar-panel-waveform" });
		requestAnimationFrame(() => {
			this.renderer = new WaveformRenderer(canvas, 0.5);
			if (!isPaused) {
				this.startAnimation();
			} else {
				this.renderer.drawLive(this.plugin.waveformBuffer.getSamples());
			}
		});

		// Control buttons
		const btnRow = wrap.createEl("div", { cls: "aar-panel-ctrl-row" });

		const pauseBtn = btnRow.createEl("button", { cls: "aar-ctrl-btn aar-ctrl-btn--pause" });
		setIcon(pauseBtn, isPaused ? "play" : "pause");
		pauseBtn.createEl("span", { text: isPaused ? "Resume" : "Pause" });
		pauseBtn.addEventListener("click", () => this.plugin.togglePause());

		const stopBtn = btnRow.createEl("button", { cls: "aar-ctrl-btn aar-ctrl-btn--stop" });
		setIcon(stopBtn, "square");
		stopBtn.createEl("span", { text: "Stop" });
		stopBtn.addEventListener("click", async () => this.plugin.stopRecording());
	}

	private renderSaved() {
		const { contentEl } = this;
		const filePath = this.savedFilePath;
		const fileName = filePath?.split("/").pop() ?? "";

		const wrap = contentEl.createEl("div", { cls: "aar-panel-saved" });

		// Success icon + heading
		const successRow = wrap.createEl("div", { cls: "aar-saved-success" });
		const iconWrap = successRow.createEl("span", { cls: "aar-saved-icon" });
		setIcon(iconWrap, "check-circle");
		successRow.createEl("span", { cls: "aar-saved-title", text: "Recording saved" });

		// File name chip
		wrap.createEl("div", { cls: "aar-saved-chip", text: fileName });

		// Embed button
		if (filePath && this.showEmbedBtn) {
			const embedBtn = wrap.createEl("button", { cls: "aar-saved-embed-btn" });
			setIcon(embedBtn, "file-plus");
			embedBtn.createEl("span", { text: "Embed in current note" });
			embedBtn.addEventListener("click", () => this.embedInCurrentFile(filePath));
		}

		// New recording — secondary
		const newBtn = wrap.createEl("button", { cls: "aar-saved-new-btn" });
		setIcon(newBtn, "rotate-ccw");
		newBtn.createEl("span", { text: "Record again" });
		newBtn.addEventListener("click", () => {
			this.savedFilePath = null;
			this.setPanelState("idle");
		});
	}

	// ─── Embed helper ─────────────────────────────────────────────────────────

	private embedInCurrentFile(filePath: string) {
		const fileName = filePath.split("/").pop() ?? filePath;
		const embed = `\n![[${fileName}]]`;

		let targetView: MarkdownView | null = null;
		this.app.workspace.iterateRootLeaves((leaf) => {
			if (!targetView && leaf.view instanceof MarkdownView) {
				targetView = leaf.view;
			}
		});

		if (!targetView) {
			new Notice("No open note to embed into");
			return;
		}

		const editor = (targetView as MarkdownView).editor;
		const lastLine = editor.lineCount() - 1;
		const lastCh = editor.getLine(lastLine).length;
		editor.replaceRange(embed, { line: lastLine, ch: lastCh });

		new Notice("Embedded in current note");
	}

	// ─── Animation ────────────────────────────────────────────────────────────

	private startAnimation() {
		if (this.animFrame) return;
		const tick = () => {
			if (!this.renderer) return;
			const buf = this.plugin.waveformBuffer;
			this.renderer.drawLive(buf.getSamples(), undefined, undefined, buf.getTotalPushes());
			this.animFrame = requestAnimationFrame(tick);
		};
		this.animFrame = requestAnimationFrame(tick);
	}

	private stopAnimation() {
		if (this.animFrame) {
			cancelAnimationFrame(this.animFrame);
			this.animFrame = 0;
		}
	}
}
