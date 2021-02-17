module.exports = {
    "env": {
        "browser": true,
        "es6": true
    },
    "extends": "eslint:recommended",
    "plugins": ["prettier"],
    "globals": {
        // Chrome API
        "chrome": "readonly",
        "google": "readonly",
        // background.js
        "getTabInfo": "readonly",
        "isScreenExist": "readonly",
        "isTabParked": "readonly",
        "addScreen": "readonly",
        "getScreen": "readonly",
        "isTabInIgnoreTabList": "readonly",
        // Utils.js
        "extractHostname": "readonly",
        "parseUrlParam": "readonly",
        "hasLastError": "readonly",
        "versionCompare": "readonly",
        "trackErrors": "readonly",
        "trackError": "readonly",
        "trackView": "readonly",
        "sql_error": "readonly",
        "debug": "readonly",
        // Settings
        "Store": "readonly",
        // Modules
        "BrowserActionControl": "readonly",
        "WhiteList": "readonly",
        "DBProvider": "readonly",
        "ADDED_ON_INDEX_NAME": "readonly",
        "SCREENS_BINARY_DB_NAME": "readonly",
        "drawPreviewTile": "readonly",
        // Exteranal Libs
        "html2canvas": "readonly",
        "$": "readonly",
        //
        "Atomics": "readonly",
        "SharedArrayBuffer": "readonly"
    },
    "parserOptions": {
        "ecmaVersion": 2018
    },
    "rules": {
        "no-prototype-builtins": "off"
    }
};
