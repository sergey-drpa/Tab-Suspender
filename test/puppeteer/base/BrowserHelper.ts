import puppeteer, { type Browser } from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const EXTENSION_PATH = path.resolve(__dirname, '../../../build_dir');

export function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

export function log(msg: string): void {
  process.stdout.write(`[${new Date().toISOString()}] ${msg}\n`);
}

export async function launchBrowser(userDataDir: string, restoreSession = false): Promise<Browser> {
  if (!fs.existsSync(EXTENSION_PATH)) {
    throw new Error(`Extension not built. Run 'npm run build' in project root.\nExpected: ${EXTENSION_PATH}`);
  }

  const args = [
    `--disable-extensions-except=${EXTENSION_PATH}`,
    `--load-extension=${EXTENSION_PATH}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-infobars',
    '--disable-sync',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--no-sandbox',              // required in Linux CI containers
    '--disable-setuid-sandbox', // required in Linux CI containers
  ];

  if (restoreSession) {
    args.push('--restore-last-session');
  }

  return puppeteer.launch({
    headless: false,
    userDataDir,
    args,
    defaultViewport: null,
  });
}
