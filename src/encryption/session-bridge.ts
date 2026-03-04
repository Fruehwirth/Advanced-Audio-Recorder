import type { App } from "obsidian";

/**
 * Bridge to AFE's SessionManager for password sharing.
 * Accesses the AFE plugin instance via app.plugins to read/write the __session__ password.
 */

interface AFESessionManager {
	getPassword(path: string): string | null;
	put(path: string, password: string, hint: string, key?: CryptoKey): void;
	hasEntries(): boolean;
}

interface AFEPlugin {
	sessionManager: AFESessionManager;
}

const AFE_PLUGIN_ID = "advanced-file-encryption";
const SESSION_KEY = "__session__";

export class SessionBridge {
	private app: App;

	constructor(app: App) {
		this.app = app;
	}

	/** Check if AFE plugin is installed and enabled */
	isAFEAvailable(): boolean {
		return this.getAFEPlugin() !== null;
	}

	/** Get the session password from AFE, if available */
	getSessionPassword(): string | null {
		const afe = this.getAFEPlugin();
		if (!afe) return null;
		return afe.sessionManager.getPassword(SESSION_KEY);
	}

	/** Store a password in AFE's session */
	storeInSession(password: string): void {
		const afe = this.getAFEPlugin();
		if (!afe) return;
		afe.sessionManager.put(SESSION_KEY, password, "", undefined);
	}

	/** Check if AFE has an active session */
	hasActiveSession(): boolean {
		const afe = this.getAFEPlugin();
		if (!afe) return false;
		return afe.sessionManager.hasEntries();
	}

	private getAFEPlugin(): AFEPlugin | null {
		const plugins = (this.app as unknown as Record<string, unknown>).plugins as
			| { plugins: Record<string, unknown> }
			| undefined;
		if (!plugins) return null;
		const afe = plugins.plugins[AFE_PLUGIN_ID] as AFEPlugin | undefined;
		if (!afe?.sessionManager) return null;
		return afe;
	}
}
