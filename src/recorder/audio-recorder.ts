import type { AARSettings, RecorderState } from "../types";
import { WAVEFORM_SAMPLE_MS } from "../types";

type EventMap = {
	"state-change": RecorderState;
	amplitude: number;
	duration: number;
	error: Error;
};

type EventCallback<K extends keyof EventMap> = (value: EventMap[K]) => void;

export class AudioRecorder {
	state: RecorderState = "inactive";

	private mediaRecorder: MediaRecorder | null = null;
	private audioContext: AudioContext | null = null;
	private analyser: AnalyserNode | null = null;
	private stream: MediaStream | null = null;
	private chunks: Blob[] = [];
	private animationFrameId = 0;
	private durationInterval = 0;
	private listeners: { [K in keyof EventMap]?: EventCallback<K>[] } = {};
	private settings: AARSettings;

	/** Duration of completed recording segments before the current one (ms). */
	private recordedMs = 0;
	/** Timestamp when the current active segment started. */
	private segmentStart = 0;

	constructor(settings: AARSettings) {
		this.settings = settings;
	}

	on<K extends keyof EventMap>(event: K, callback: EventCallback<K>) {
		if (!this.listeners[event]) {
			(this.listeners as Record<string, unknown[]>)[event] = [];
		}
		(this.listeners[event] as EventCallback<K>[]).push(callback);
	}

	private emit<K extends keyof EventMap>(event: K, value: EventMap[K]) {
		const cbs = this.listeners[event] as EventCallback<K>[] | undefined;
		if (cbs) cbs.forEach((cb) => cb(value));
	}

	async start(): Promise<void> {
		if (this.state === "recording") throw new Error("Already recording");

		const constraints: MediaStreamConstraints = {
			audio: {
				deviceId:
					this.settings.inputDeviceId !== "default"
						? { exact: this.settings.inputDeviceId }
						: undefined,
				echoCancellation: false,
				noiseSuppression: false,
				autoGainControl: false,
			},
		};

		this.stream = await navigator.mediaDevices.getUserMedia(constraints);

		// Set up AudioContext + AnalyserNode for amplitude data
		this.audioContext = new AudioContext();
		const source = this.audioContext.createMediaStreamSource(this.stream);
		this.analyser = this.audioContext.createAnalyser();
		this.analyser.fftSize = 256;
		source.connect(this.analyser);

		// Find a supported MIME type
		let mimeType = this.settings.mimeType;
		if (!MediaRecorder.isTypeSupported(mimeType)) {
			const fallbacks = [
				"audio/webm;codecs=opus",
				"audio/webm",
				"audio/ogg;codecs=opus",
				"audio/mp4",
			];
			mimeType = fallbacks.find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
		}

		this.mediaRecorder = new MediaRecorder(this.stream, {
			mimeType: mimeType || undefined,
			audioBitsPerSecond: this.settings.audioBitrate,
		});

		this.chunks = [];
		this.recordedMs = 0;

		this.mediaRecorder.ondataavailable = (e) => {
			if (e.data.size > 0) this.chunks.push(e.data);
		};

		this.mediaRecorder.onerror = () => {
			this.emit("error", new Error("MediaRecorder error"));
		};

		this.mediaRecorder.start(250); // collect chunks every 250ms
		this.segmentStart = Date.now();
		this.state = "recording";
		this.emit("state-change", "recording");

		this.startAmplitudeLoop();
		this.startDurationLoop();
	}

	pause(): void {
		if (this.state !== "recording" || !this.mediaRecorder) return;

		this.mediaRecorder.pause();
		this.recordedMs += Date.now() - this.segmentStart;
		this.segmentStart = 0;

		// Stop amplitude loop — waveform freezes
		if (this.animationFrameId) {
			cancelAnimationFrame(this.animationFrameId);
			this.animationFrameId = 0;
		}

		this.state = "paused";
		this.emit("state-change", "paused");
	}

	resume(): void {
		if (this.state !== "paused" || !this.mediaRecorder) return;

		this.mediaRecorder.resume();
		this.segmentStart = Date.now();
		this.state = "recording";
		this.emit("state-change", "recording");

		this.startAmplitudeLoop();
	}

	async stop(): Promise<Blob> {
		return new Promise<Blob>((resolve, reject) => {
			if (
				!this.mediaRecorder ||
				(this.state !== "recording" && this.state !== "paused")
			) {
				reject(new Error("Not recording"));
				return;
			}

			// Capture final segment duration before state changes
			if (this.state === "recording" && this.segmentStart > 0) {
				this.recordedMs += Date.now() - this.segmentStart;
			}

			this.state = "stopping";
			this.emit("state-change", "stopping");

			this.mediaRecorder.onstop = () => {
				this.cleanup();
				const mimeType = this.mediaRecorder?.mimeType ?? "audio/webm";
				const blob = new Blob(this.chunks, { type: mimeType });
				this.state = "inactive";
				this.emit("state-change", "inactive");
				resolve(blob);
			};

			this.mediaRecorder.stop();
		});
	}

	getAmplitudeData(): Float32Array | null {
		if (!this.analyser) return null;
		const data = new Float32Array(this.analyser.frequencyBinCount);
		this.analyser.getFloatTimeDomainData(data);
		return data;
	}

	getCurrentAmplitude(): number {
		const data = this.getAmplitudeData();
		if (!data) return 0;
		let sum = 0;
		for (let i = 0; i < data.length; i++) {
			sum += data[i] * data[i];
		}
		return Math.sqrt(sum / data.length);
	}

	/** Returns the total recorded duration in seconds, excluding paused time. */
	getDuration(): number {
		if (this.state === "inactive") return 0;
		if (this.state === "paused") return this.recordedMs / 1000;
		// recording or stopping: include current segment
		const currentSegment = this.segmentStart > 0 ? Date.now() - this.segmentStart : 0;
		return (this.recordedMs + currentSegment) / 1000;
	}

	private lastSampleTime = 0;

	private startAmplitudeLoop() {
		const tick = () => {
			if (this.state !== "recording") return;
			const now = Date.now();
			if (now - this.lastSampleTime >= WAVEFORM_SAMPLE_MS) {
				this.emit("amplitude", this.getCurrentAmplitude());
				this.lastSampleTime = now;
			}
			this.animationFrameId = requestAnimationFrame(tick);
		};
		this.animationFrameId = requestAnimationFrame(tick);
	}

	private startDurationLoop() {
		this.durationInterval = window.setInterval(() => {
			if (this.state === "recording" || this.state === "paused") {
				this.emit("duration", this.getDuration());
			}
		}, 200);
	}

	private cleanup() {
		if (this.animationFrameId) {
			cancelAnimationFrame(this.animationFrameId);
			this.animationFrameId = 0;
		}
		if (this.durationInterval) {
			clearInterval(this.durationInterval);
			this.durationInterval = 0;
		}
		if (this.stream) {
			this.stream.getTracks().forEach((t) => t.stop());
			this.stream = null;
		}
		if (this.audioContext) {
			this.audioContext.close();
			this.audioContext = null;
		}
		this.analyser = null;
	}
}
