export interface AARSettings {
	recordingFolder: string;
	mimeType: string;
	audioBitrate: number;
	encryptRecordings: boolean;
	fileNamePattern: string;
	inputDeviceId: string;
}

export const DEFAULT_SETTINGS: AARSettings = {
	recordingFolder: "Recordings",
	mimeType: "audio/webm;codecs=opus",
	audioBitrate: 128000,
	encryptRecordings: false,
	fileNamePattern: "Recording YYYY-MM-DD HHmmss",
	inputDeviceId: "default",
};

export const SUPPORTED_MIME_TYPES = [
	"audio/webm;codecs=opus",
	"audio/webm",
	"audio/ogg;codecs=opus",
	"audio/mp4",
];

export const CODEBLOCK_TYPE = "audio-recording";
export const LOCKED_AUDIO_EXTENSION = "lockedaudio";

/** ms between amplitude samples pushed to WaveformBuffer */
export const WAVEFORM_SAMPLE_MS = 75;
/** Number of samples that fills the live waveform canvas (= 15 seconds) */
export const WAVEFORM_WINDOW_SAMPLES = 200;

export type RecorderState = "inactive" | "recording" | "paused" | "stopping";

export interface RecorderEvents {
	"state-change": (state: RecorderState) => void;
	"amplitude": (value: number) => void;
	"duration": (seconds: number) => void;
	"error": (error: Error) => void;
}
