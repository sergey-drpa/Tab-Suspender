let trackError = async (error: Error) => {};
let trackView = async (viewName: string, info?: object) => {};


function trackErrors(pageName /* For example 'popup' */, buttons /* true/false */) {
	const tsErrorGaKey = 'ts_error';
	const sendErrorsKey = 'sendErrors';

	const eventsAccumulator = [];

	setInterval(anonymousEventsToGA, 10000);

	trackError = async function (error: Error) {
		eventsAccumulator.push({
			name: tsErrorGaKey,
			params: {
				id: pageName,
				info: JSON.stringify(error, Object.getOwnPropertyNames(error)),
			},
		});
	}

	trackView = async function (viewName: string, info?: object) {
		eventsAccumulator.push({
			name: viewName,
			params: {
				id: pageName,
				info: info ? JSON.stringify(info, Object.getOwnPropertyNames(info)) : null,
			},
		});
	}

	const GA_ENDPOINT = 'https://www.google-analytics.com/mp/collect';
	const MEASUREMENT_ID = `G-Q3Q3MKPR1Q`;
	const API_SECRET = `8FNw9rVgTC-5n0WXEH2kLQ`;

	async function anonymousEventsToGA() {
		/** INFO: Sending an anonymous errors logs for improve TS quality
		 * It can be disabled in Wizard page on the last step:
		 * chrome-extension://fiabciakcmgepblmdkmemdbbkilneeeh/wizard_background.html
		 * **/

		let events = eventsAccumulator.splice(0);

		const idSendErrors = await SettingsStore.get(sendErrorsKey, SETTINGS_STORAGE_NAMESPACE);

		if (idSendErrors !== true)
			return;

		if (events.length == 0)
			return;

		await fetch(
			`${GA_ENDPOINT}?measurement_id=${MEASUREMENT_ID}&api_secret=${API_SECRET}`,
			{
				method: 'POST',
				body: JSON.stringify({
					client_id: self.crypto.randomUUID(),
					consent: {
						ad_user_data: "DENIED",
						ad_personalization: "DENIED",
					},
					events: events,
				}),
			}
		);
	}
}
