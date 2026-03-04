/**
 * Rolling buffer of normalized amplitude samples for waveform visualization.
 * Maintains a fixed-size ring buffer that can be read as a contiguous array.
 */
export class WaveformBuffer {
	private buffer: Float32Array;
	private writeIndex = 0;
	private count = 0;

	/**
	 * Tracked peak amplitude for adaptive normalization.
	 * Decays slowly so that after a loud period, a quieter signal
	 * gradually grows back to fill the waveform height.
	 * Decay: 0.997 per 75 ms sample ≈ half-life of ~22 seconds.
	 */
	private peak = 0.02;
	private _totalPushes = 0;

	constructor(private size: number = 600) {
		this.buffer = new Float32Array(size);
	}

	/** Total number of samples ever pushed (monotonically increasing). */
	getTotalPushes(): number {
		return this._totalPushes;
	}

	/** Push a raw RMS amplitude value. Normalizes adaptively to the current peak. */
	push(amplitude: number) {
		this._totalPushes++;
		// Slowly decay peak toward the noise floor
		this.peak = Math.max(0.02, this.peak * 0.997);
		// Immediately raise peak if new value is louder
		if (amplitude > this.peak) this.peak = amplitude;

		// Normalize: the loudest recent sample maps to ~0.95, leaving headroom
		const normalized = Math.min(1, (amplitude / this.peak) * 0.95);
		this.buffer[this.writeIndex] = normalized;
		this.writeIndex = (this.writeIndex + 1) % this.size;
		if (this.count < this.size) this.count++;
	}

	/** Get samples in chronological order (oldest first). */
	getSamples(): Float32Array {
		const result = new Float32Array(this.count);
		if (this.count < this.size) {
			// Buffer not yet full — data starts at 0
			result.set(this.buffer.subarray(0, this.count));
		} else {
			// Buffer full — read from writeIndex (oldest) wrapping around
			const first = this.buffer.subarray(this.writeIndex);
			const second = this.buffer.subarray(0, this.writeIndex);
			result.set(first);
			result.set(second, first.length);
		}
		return result;
	}

	/** Number of samples currently stored. */
	getCount(): number {
		return this.count;
	}

	reset() {
		this.buffer.fill(0);
		this.writeIndex = 0;
		this.count = 0;
		this.peak = 0.02;
		this._totalPushes = 0;
	}
}
