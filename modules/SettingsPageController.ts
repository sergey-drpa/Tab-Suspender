interface UpdateTabSettingsBGMessage {
	method: string;
	restoreEvent: string;
	reloadTabOnRestore: boolean;
	parkBgColor: string;
	screenshotCssStyle: string;
	restoreButtonView: string;
	tabIconOpacityChange: boolean;
	tabIconStatusVisualize: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
class SettingsPageController {

	private settingsPage = chrome.runtime.getURL(chrome.runtime.getManifest().options_page);

	reloadSettingsPage() {
		chrome.runtime.getContexts({ documentUrls: [this.settingsPage] }, (contexts: chrome.runtime.ExtensionContext[]) => {
			for (let i = 0; i <= contexts.length; i++) {
				if (contexts[i]) {
					chrome.tabs.reload(contexts[i].tabId, {}).catch(console.error);
				}
			}
		});
	}

	static openSettings() {
		const manifest = chrome.runtime.getManifest();
		focusOrOpenTSPage(manifest.options_page);
	}

	/**
	 *
	 */
	static async reloadSettings(options?) {

		/* STORE TABS STATE */
		tabObserver.settingsChanged();

		await preInit(<IntOptions>{ reloadSettings: true });

		if (!options || !options.fromSettingsPage)
			settingsPageController.reloadSettingsPage();

		chrome.runtime.sendMessage<UpdateTabSettingsBGMessage>({
			method: '[AutomaticTabCleaner:UpdateTabsSettings]',
			restoreEvent: await getRestoreEvent(),
			reloadTabOnRestore: await getReloadTabOnRestore(),
			parkBgColor: await getParkBgColor(),
			screenshotCssStyle: await getScreenshotCssStyle(),
			restoreButtonView: await getRestoreButtonView(),
			tabIconOpacityChange: await getTabIconOpacityChange(),
			tabIconStatusVisualize: await getTabIconStatusVisualize()
		}).catch(console.error);
	}
}