# Advanced Audio Recorder

An Obsidian plugin for recording audio directly inside your notes.

## What it does

When you start a recording, a live waveform block gets inserted at your cursor. Stop the recording and it turns into an inline audio player with a waveform, seek bar, and volume control.

Recordings can optionally be encrypted with AES-256-GCM. If you have the Advanced File Encryption plugin installed, passwords are shared through its session so you don't have to enter them twice.

## Features

- Live waveform during recording
- Custom playback embed for all common audio formats
- Optional per-recording encryption (.lockedaudio format)
- Lock/unlock toggle directly on the player to convert between encrypted and plain files
- Opens .lockedaudio and .wav files in a proper player tab instead of a raw text view

## Installation

Not on the community plugin list yet. Install manually:

1. Build with `npm run build`
2. Copy `main.js`, `manifest.json` and `styles.css` into `.obsidian/plugins/advanced-audio-recorder/`
3. Enable the plugin in Obsidian settings

## Settings

- Recording folder
- File name pattern
- Audio format and bitrate
- Input device
- Auto-encrypt new recordings (off by default)
