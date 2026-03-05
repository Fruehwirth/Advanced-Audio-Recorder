import { MarkdownRenderChild, Platform, setIcon } from "obsidian";
import type AdvancedAudioRecorderPlugin from "../main";
import { CODEBLOCK_TYPE } from "../types";
import { WaveformRenderer } from "./waveform-renderer";

export function registerRecordingCodeBlock(plugin: AdvancedAudioRecorderPlugin) {
	plugin.registerMarkdownCodeBlockProcessor(
		CODEBLOCK_TYPE,
		(source, el, ctx) => {
			const child = new RecordingBlockWidget(el, plugin, source.trim());
			ctx.addChild(child);
		}
	);
}

class RecordingBlockWidget extends MarkdownRenderChild {
	private plugin: AdvancedAudioRecorderPlugin;
	private renderer: WaveformRenderer | null = null;
	private animFrame = 0;
	private durationEl: HTMLElement | null = null;
	private dotEl: HTMLElement | null = null;
	private pauseBtn: HTMLElement | null = null;
	private blockId: string;

	constructor(
		containerEl: HTMLElement,
		plugin: AdvancedAudioRecorderPlugin,
		source: string
	) {
		super(containerEl);
		this.plugin = plugin;

		let id = "";
		try {
			const parsed = JSON.parse(source);
			id = parsed.id ?? "";
		} catch {
			// ignore parse errors
		}
		this.blockId = id;
	}

	onload() {
		const state = this.plugin.recorder?.state;
		const isActive =
			(state === "recording" || state === "paused") &&
			this.blockId === this.plugin.recordingId;

		const container = this.containerEl.createEl("div", {
			cls: "aar-recording-block",
		});

		if (!isActive) {
			const header = container.createEl("div", { cls: "aar-recording-header" });
			header.createEl("span", { text: "Recording not active" });
			return;
		}

		// Header: dot + label + duration
		const header = container.createEl("div", { cls: "aar-recording-header" });
		this.dotEl = header.createEl("span", { cls: "aar-recording-dot" });
		header.createEl("span", { text: "Recording" });
		this.durationEl = header.createEl("span", { cls: "aar-recording-duration" });

		// Waveform canvas
		const canvas = container.createEl("canvas", { cls: "aar-waveform-canvas" });

		// Button row
		const btnRow = container.createEl("div", { cls: "aar-recording-btn-row" });

		this.pauseBtn = btnRow.createEl("button", { cls: "aar-recording-btn aar-recording-btn--pause" });
		setIcon(this.pauseBtn, "pause");
		this.pauseBtn.createEl("span", { text: "Pause" });
		this.pauseBtn.addEventListener("click", () => this.plugin.togglePause());

		const stopBtn = btnRow.createEl("button", { cls: "aar-recording-btn aar-recording-btn--stop" });
		setIcon(stopBtn, "square");
		stopBtn.createEl("span", { text: "Stop" });
		stopBtn.addEventListener("click", () => this.plugin.stopRecording());

		// Apply initial paused state if needed
		if (state === "paused") this.applyPausedState();

		requestAnimationFrame(() => {
			this.renderer = new WaveformRenderer(canvas, Platform.isMobile ? 0.5 : 1);
			if (this.plugin.recorder?.state === "recording") {
				this.startAnimation();
			} else {
				// Render the frozen waveform once
				this.renderer.drawLive(this.plugin.waveformBuffer.getSamples());
			}
		});
	}

	onunload() {
		if (this.animFrame) {
			cancelAnimationFrame(this.animFrame);
			this.animFrame = 0;
		}
	}

	/** Called by the plugin when pause/resume state changes. */
	onStateChange(paused: boolean) {
		if (paused) {
			this.applyPausedState();
			if (this.animFrame) {
				cancelAnimationFrame(this.animFrame);
				this.animFrame = 0;
			}
		} else {
			this.applyRecordingState();
			this.startAnimation();
		}
	}

	private applyPausedState() {
		this.dotEl?.addClass("aar-recording-dot--paused");
		if (this.pauseBtn) {
			this.pauseBtn.empty();
			setIcon(this.pauseBtn, "play");
			this.pauseBtn.createEl("span", { text: "Resume" });
		}
	}

	private applyRecordingState() {
		this.dotEl?.removeClass("aar-recording-dot--paused");
		if (this.pauseBtn) {
			this.pauseBtn.empty();
			setIcon(this.pauseBtn, "pause");
			this.pauseBtn.createEl("span", { text: "Pause" });
		}
	}

	private startAnimation() {
		const tick = () => {
			if (!this.renderer) return;

			const buf = this.plugin.waveformBuffer;
			this.renderer.drawLive(buf.getSamples(), undefined, undefined, buf.getTotalPushes());

			if (this.durationEl && this.plugin.recorder) {
				const secs = this.plugin.recorder.getDuration();
				const mm = String(Math.floor(secs / 60)).padStart(2, "0");
				const ss = String(Math.floor(secs % 60)).padStart(2, "0");
				this.durationEl.textContent = `${mm}:${ss}`;
			}

			if (this.plugin.recorder?.state === "recording") {
				this.animFrame = requestAnimationFrame(tick);
			}
		};
		this.animFrame = requestAnimationFrame(tick);
	}
}
