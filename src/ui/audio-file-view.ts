import { FileView, TFile, WorkspaceLeaf } from "obsidian";
import type AdvancedAudioRecorderPlugin from "../main";
import { PlaybackEmbedWidget } from "./playback-embed";

export const AUDIO_FILE_VIEW_TYPE = "aar-audio-file-view";

export class AudioFileView extends FileView {
	private plugin: AdvancedAudioRecorderPlugin;

	constructor(leaf: WorkspaceLeaf, plugin: AdvancedAudioRecorderPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return AUDIO_FILE_VIEW_TYPE;
	}

	getDisplayText(): string {
		return this.file?.basename ?? "Audio";
	}

	getIcon(): string {
		return "music";
	}

	async onLoadFile(file: TFile): Promise<void> {
		this.contentEl.empty();
		const wrap = this.contentEl.createEl("div", { cls: "aar-file-view-wrap" });
		this.addChild(new PlaybackEmbedWidget(wrap, this.plugin, file.path));
	}

	async onUnloadFile(_file: TFile): Promise<void> {
		this.contentEl.empty();
	}
}
