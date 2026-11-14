# CLAUDE.md

## Project Overview
This project is a Chrome Extension Tab-Suspender (https://chromewebstore.google.com/detail/tab-suspender/fiabciakcmgepblmdkmemdbbkilneeeh?hl=ru&pli=1)
Automatically suspend, park, hibernate inactive tabs and save up to 80% of memory, reduce load on your device, battery and heat.

Make an approximate picture of the extension's functionality by settings manifest: ./fancy-settings/source/manifest.js

Built with: JS, TS, HTML, Jest for tests

## Development Guidelines
  Tests usually not run successfully by the first run cause there need some jest cache, in this case do not pay attention if the tests fails at first time - just restart it second time.
  Modules from /modules injects into running Chrome Extension by file worker.ts .
  In the project it is not allowed to use construction like this "export class ..." and "import ..."

  Do not change sensitive data like hotkey binding and etc. without asking! this is production project and those changes can break down user work.

  Never re-implement module logic in test, you need to call real implementation!!!

## Tests
  * When you writing Tests - do not forget find bugs in core logic if you see it!
  * Tests:
    * Unit Tests: ./test/modules
    * Puppeteer - sensitive notes located here: ./docs/memory/project_e2e_tests.md
  * Actual summary located here: ./docs/TEST_CASES.md - always update it when add/update/remove tests

## Important Commands
npm bun build - to build extension for release or tests - write build to ./build_dir