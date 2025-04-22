let trackError = async (error: Error) => {};
let trackView = async (viewName: string, info?: object) => {};


function trackErrors(pageName /* For example 'popup' */, buttons /* true/false */) {
	const tsErrorGaKey = 'ts_error';
	const sendErrorsKey = 'sendErrors';
	const extensionRootPath = chrome.runtime.getURL('');

	const eventsAccumulator = [];

	trackError = async function (error: Error) {
		void chrome.runtime.sendMessage({
			method: '[TS:offscreenDocument:sendError]',
			type: 'error',
			error: {
				message: `${pageName}: ${error.message}`,
				stack: error.stack.replaceAll(extensionRootPath, ""),
			},
		});
	}

	trackView = async function (viewName: string, info?: object) {
		void chrome.runtime.sendMessage({
			method: '[TS:offscreenDocument:sendError]',
			type: 'event',
			event: {
				message: viewName,
				...info,
			},
		});
	}
}

if (typeof module != 'undefined')
	module.exports = {
		trackErrors,
		trackError,
		trackView,
	};
