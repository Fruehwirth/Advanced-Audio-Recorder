import { setIcon } from "obsidian";
import type AdvancedAudioRecorderPlugin from "../main";
import type { RecorderState } from "../types";
import { WaveformRenderer } from "./waveform-renderer";

export class StatusBarWidget {
	private plugin: AdvancedAudioRecorderPlugin;
	private statusEl: HTMLElement;
	private dotEl: HTMLElement;
	private textEl: HTMLElement;
	private popup: HTMLElement | null = null;
	private popupRenderer: WaveformRenderer | null = null;
	private popupDurationEl: HTMLElement | null = null;
	private popupPauseBtn: HTMLElement | null = null;
	private popupAnimFrame = 0;

	constructor(plugin: AdvancedAudioRecorderPlugin) {
		this.plugin = plugin;

		this.statusEl = plugin.addStatusBarItem();
		this.statusEl.addClass("aar-status-bar");
		this.statusEl.style.display = "none";

		this.dotEl = this.statusEl.createEl("span", { cls: "aar-status-dot" });
		this.textEl = this.statusEl.createEl("span", {
			cls: "aar-status-text",
			text: "Recording",
		});

		this.statusEl.addEventListener("click", () => this.togglePopup());
	}

	show() {
		this.statusEl.style.display = "flex";
	}

	hide() {
		this.statusEl.style.display = "none";
		this.closePopup();
	}

	updateDuration(seconds: number) {
		const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
		const ss = String(Math.floor(seconds % 60)).padStart(2, "0");
		const state = this.plugin.recorder?.state;
		const label = state === "paused" ? "Paused" : "Recording";
		this.textEl.textContent = `${label} \u2022 ${mm}:${ss}`;

		if (this.popupDurationEl) {
			this.popupDurationEl.textContent = `${mm}:${ss}`;
		}
	}

	updateState(state: RecorderState) {
		if (state === "paused") {
			this.dotEl.addClass("aar-recording-dot--paused");
			this.textEl.textContent = this.textEl.textContent?.replace(
				"Recording",
				"Paused"
			) ?? "Paused";
			// Stop waveform animation
			if (this.popupAnimFrame) {
				cancelAnimationFrame(this.popupAnimFrame);
				this.popupAnimFrame = 0;
			}
			this.updatePopupPauseBtn(true);
		} else if (state === "recording") {
			this.dotEl.removeClass("aar-recording-dot--paused");
			this.textEl.textContent = this.textEl.textContent?.replace(
				"Paused",
				"Recording"
			) ?? "Recording";
			this.startPopupAnimation();
			this.updatePopupPauseBtn(false);
		}
	}

	destroy() {
		this.closePopup();
		this.statusEl.remove();
	}

	private togglePopup() {
		if (this.popup) {
			this.closePopup();
		} else {
			this.openPopup();
		}
	}

	private openPopup() {
		if (this.popup) return;

		this.popup = document.body.createEl("div", { cls: "aar-popup" });

		// Header: dot + title + duration
		const header = this.popup.createEl("div", { cls: "aar-popup-header" });
		const title = header.createEl("div", { cls: "aar-popup-title" });
		const popupDot = title.createEl("span", { cls: "aar-status-dot" });
		if (this.plugin.recorder?.state === "paused") {
			popupDot.addClass("aar-recording-dot--paused");
		}
		title.createEl("span", { text: "Recording" });
		this.popupDurationEl = header.createEl("span", { cls: "aar-popup-duration" });

		// Waveform canvas
		const canvas = this.popup.createEl("canvas", { cls: "aar-popup-waveform" });
		requestAnimationFrame(() => {
			this.popupRenderer = new WaveformRenderer(canvas);
			if (this.plugin.recorder?.state === "recording") {
				this.startPopupAnimation();
			} else if (this.plugin.recorder?.state === "paused") {
				// Draw frozen waveform
				this.popupRenderer.drawLive(this.plugin.waveformBuffer.getSamples());
			}
		});

		// Button row: pause + stop
		const btnRow = this.popup.createEl("div", { cls: "aar-popup-btn-row" });

		this.popupPauseBtn = btnRow.createEl("button", {
			cls: "aar-popup-btn aar-popup-btn--pause",
		});
		const isPaused = this.plugin.recorder?.state === "paused";
		setIcon(this.popupPauseBtn, isPaused ? "play" : "pause");
		this.popupPauseBtn.createEl("span", { text: isPaused ? "Resume" : "Pause" });
		this.popupPauseBtn.addEventListener("click", () => this.plugin.togglePause());

		const stopBtn = btnRow.createEl("button", {
			cls: "aar-popup-btn aar-popup-btn--stop",
		});
		setIcon(stopBtn, "square");
		stopBtn.createEl("span", { text: "Stop" });
		stopBtn.addEventListener("click", () => this.plugin.stopRecording());
	}

	private closePopup() {
		if (this.popupAnimFrame) {
			cancelAnimationFrame(this.popupAnimFrame);
			this.popupAnimFrame = 0;
		}
		if (this.popup) {
			this.popup.remove();
			this.popup = null;
			this.popupRenderer = null;
			this.popupDurationEl = null;
			this.popupPauseBtn = null;
		}
	}

	private startPopupAnimation() {
		if (this.popupAnimFrame) return; // already running
		const tick = () => {
			if (!this.popup || !this.popupRenderer) return;
			const buf = this.plugin.waveformBuffer;
			this.popupRenderer.drawLive(buf.getSamples(), undefined, undefined, buf.getTotalPushes());
			this.popupAnimFrame = requestAnimationFrame(tick);
		};
		this.popupAnimFrame = requestAnimationFrame(tick);
	}

	private updatePopupPauseBtn(paused: boolean) {
		if (!this.popupPauseBtn) return;
		this.popupPauseBtn.empty();
		setIcon(this.popupPauseBtn, paused ? "play" : "pause");
		this.popupPauseBtn.createEl("span", { text: paused ? "Resume" : "Pause" });
	}
}
