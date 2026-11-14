/**
 * Extended Chrome API typings for newer features not yet in @types/chrome
 * Chrome 145+ features
 */

declare namespace chrome.tabs {
	/**
	 * Represents the absence of a split tab.
	 * Indicates a tab that is not in any Split View.
	 * @since Chrome 145
	 */
	export const SPLIT_VIEW_ID_NONE: -1;

	/**
	 * Extended Tab interface with Split View support
	 */
	export interface Tab {
		/**
		 * The ID of the Split View that the tab belongs to.
		 * Returns SPLIT_VIEW_ID_NONE (-1) for tabs not in a Split View.
		 * @since Chrome 145
		 */
		splitViewId?: number;
	}

	/**
	 * Query options extended with splitViewId
	 */
	export interface QueryInfo {
		/**
		 * Query tabs by Split View ID
		 * @since Chrome 145
		 */
		splitViewId?: number;
	}
}
