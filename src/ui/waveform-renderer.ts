import { WAVEFORM_WINDOW_SAMPLES, WAVEFORM_SAMPLE_MS } from "../types";

/**
 * Shared canvas-based waveform renderer. HiDPI-aware.
 * Used by the recording code block, status bar popup, and playback embed.
 */
export class WaveformRenderer {
	private canvas: HTMLCanvasElement;
	private ctx: CanvasRenderingContext2D;
	private dpr: number;
	private ampScale: number;
	private lastPushCount = 0;
	private lastPushTime = 0;

	constructor(canvas: HTMLCanvasElement, amplitudeScale = 1) {
		this.canvas = canvas;
		this.ctx = canvas.getContext("2d")!;
		this.dpr = window.devicePixelRatio || 1;
		this.ampScale = amplitudeScale;
		this.resize();
	}

	resize() {
		this.dpr = window.devicePixelRatio || 1;
		const rect = this.canvas.getBoundingClientRect();
		this.canvas.width = rect.width * this.dpr;
		this.canvas.height = rect.height * this.dpr;
		this.ctx.scale(this.dpr, this.dpr);
	}

	/**
	 * Draw live amplitude bars that slide smoothly from right to left.
	 * Each bar is tied to its sample and moves continuously rather than
	 * snapping between fixed grid positions.
	 * @param samples Normalized amplitude values (0..1), chronological order
	 * @param windowSamples How many samples fit across the full width (default = 15 s worth)
	 * @param color Bar color (default: uses CSS variable)
	 * @param totalPushes Monotonic push count from WaveformBuffer — enables smooth sub-pixel scrolling
	 */
	drawLive(samples: Float32Array, windowSamples = WAVEFORM_WINDOW_SAMPLES, color?: string, totalPushes?: number) {
		const { canvas, ctx, dpr } = this;
		const w = canvas.width / dpr;
		const h = canvas.height / dpr;

		ctx.clearRect(0, 0, w, h);

		const step = w / windowSamples;           // px per sample slot
		const barWidth = Math.max(1, step * 0.7); // 70% filled, 30% gap
		const minBarHeight = 2;
		const centerY = h / 2;

		// Compute fractional scroll offset for smooth movement between samples
		let frac = 0;
		if (totalPushes !== undefined) {
			const now = performance.now();
			if (totalPushes !== this.lastPushCount) {
				this.lastPushTime = now;
				this.lastPushCount = totalPushes;
			}
			if (this.lastPushTime > 0) {
				frac = Math.min(1, (now - this.lastPushTime) / WAVEFORM_SAMPLE_MS);
			}
		}

		const barColor = color || this.getCSSColor("--interactive-accent", "#7c3aed");
		ctx.fillStyle = barColor;

		// Each bar's x position is based on its age (newest = 0, oldest = N-1).
		// Between sample arrivals, `frac` grows from 0→1, sliding all bars
		// left by one slot width over the sample period.
		const rightEdge = (windowSamples - 1) * step;

		for (let i = samples.length - 1; i >= 0; i--) {
			const age = (samples.length - 1 - i) + frac;
			const x = rightEdge - age * step;

			if (x + barWidth < 0) break;  // rest are further left, stop early

			const amp = samples[i];
			const barHeight = Math.max(minBarHeight, amp * (h - 4) * this.ampScale);
			const y = centerY - barHeight / 2;

			ctx.beginPath();
			ctx.roundRect(x, y, barWidth, barHeight, 1);
			ctx.fill();
		}
	}

	/**
	 * Draw a static waveform with an optional playback progress indicator.
	 * @param samples Normalized amplitude values for the full duration
	 * @param progress Playback progress (0..1)
	 */
	drawStatic(samples: Float32Array, progress: number = 0) {
		const { canvas, ctx, dpr } = this;
		const w = canvas.width / dpr;
		const h = canvas.height / dpr;

		ctx.clearRect(0, 0, w, h);

		const barWidth = 2;
		const gap = 1;
		const step = barWidth + gap;
		const barCount = Math.floor(w / step);
		const minBarHeight = 2;

		const played = this.getCSSColor("--interactive-accent", "#7c3aed");
		const unplayed = this.getCSSColor("--text-faint", "#888");

		const centerY = h / 2;
		const cursorX = progress * w;

		for (let i = 0; i < barCount; i++) {
			const sampleIdx = Math.floor((i / barCount) * samples.length);
			const amp = sampleIdx < samples.length ? samples[sampleIdx] : 0;
			const barHeight = Math.max(minBarHeight, amp * (h - 4) * this.ampScale);
			const x = i * step;
			const y = centerY - barHeight / 2;

			ctx.fillStyle = x + barWidth <= cursorX ? played : unplayed;

			ctx.beginPath();
			ctx.roundRect(x, y, barWidth, barHeight, 1);
			ctx.fill();
		}

		// Draw cursor line when progress > 0
		if (progress > 0 && progress < 1) {
			ctx.save();
			ctx.globalAlpha = 0.9;
			ctx.strokeStyle = played;
			ctx.lineWidth = 1.5;
			ctx.beginPath();
			ctx.moveTo(cursorX, 2);
			ctx.lineTo(cursorX, h - 2);
			ctx.stroke();
			ctx.restore();
		}
	}

	private getCSSColor(variable: string, fallback: string): string {
		const value = getComputedStyle(this.canvas).getPropertyValue(variable).trim();
		return value || fallback;
	}
}
