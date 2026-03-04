import { App, PluginSettingTab, Setting } from "obsidian";
import type AdvancedAudioRecorderPlugin from "./main";
import { SUPPORTED_MIME_TYPES } from "./types";

export class AARSettingTab extends PluginSettingTab {
	plugin: AdvancedAudioRecorderPlugin;

	constructor(app: App, plugin: AdvancedAudioRecorderPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Recording folder")
			.setDesc("Folder where recordings are saved (relative to vault root)")
			.addText((text) =>
				text
					.setPlaceholder("Recordings")
					.setValue(this.plugin.settings.recordingFolder)
					.onChange(async (value) => {
						this.plugin.settings.recordingFolder = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("File name pattern")
			.setDesc("Pattern for recording file names. YYYY, MM, DD, HH, mm, ss are replaced.")
			.addText((text) =>
				text
					.setPlaceholder("Recording YYYY-MM-DD HHmmss")
					.setValue(this.plugin.settings.fileNamePattern)
					.onChange(async (value) => {
						this.plugin.settings.fileNamePattern = value;
						await this.plugin.saveSettings();
					})
			);

		const supportedTypes = SUPPORTED_MIME_TYPES.filter((t) =>
			MediaRecorder.isTypeSupported(t)
		);

		new Setting(containerEl)
			.setName("Audio format")
			.setDesc("Recording codec and container format")
			.addDropdown((drop) => {
				for (const t of supportedTypes) {
					drop.addOption(t, t);
				}
				drop.setValue(this.plugin.settings.mimeType);
				drop.onChange(async (value) => {
					this.plugin.settings.mimeType = value;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Audio bitrate")
			.setDesc("Bitrate in kbps")
			.addDropdown((drop) => {
				drop.addOption("64000", "64 kbps");
				drop.addOption("96000", "96 kbps");
				drop.addOption("128000", "128 kbps");
				drop.addOption("192000", "192 kbps");
				drop.addOption("256000", "256 kbps");
				drop.setValue(String(this.plugin.settings.audioBitrate));
				drop.onChange(async (value) => {
					this.plugin.settings.audioBitrate = parseInt(value);
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Input device")
			.setDesc("Microphone to use for recording")
			.addDropdown(async (drop) => {
				drop.addOption("default", "Default");
				try {
					const devices = await navigator.mediaDevices.enumerateDevices();
					for (const d of devices) {
						if (d.kind === "audioinput" && d.deviceId !== "default") {
							drop.addOption(d.deviceId, d.label || d.deviceId);
						}
					}
				} catch {
					// permissions not yet granted
				}
				drop.setValue(this.plugin.settings.inputDeviceId);
				drop.onChange(async (value) => {
					this.plugin.settings.inputDeviceId = value;
					await this.plugin.saveSettings();
				});
			});

		const encryptSetting = new Setting(containerEl)
			.setName("Encrypt new recordings")
			.setDesc("Automatically encrypt recordings with AES-256-GCM when saving.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.encryptRecordings)
					.onChange(async (value) => {
						this.plugin.settings.encryptRecordings = value;
						await this.plugin.saveSettings();
					})
			);

		if (this.plugin.encryptor?.bridge.isAFEAvailable()) {
			encryptSetting.descEl.createEl("br");
			encryptSetting.descEl.createEl("span", {
				text: "Advanced File Encryption detected — passwords are shared via its session.",
				cls: "mod-warning",
			});
		}
	}
}
