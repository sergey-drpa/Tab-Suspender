import puppeteer, { type Browser } from 'puppeteer';
import { type ChildProcess } from 'child_process';
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

export function getBrowserPID(browser: Browser): number | null {
  const proc = browser.process() as ChildProcess | null;
  return proc?.pid ?? null;
}

export function getProfileDir(userDataDir: string): string {
  return path.join(userDataDir, 'Default');
}

export function copyCurrentSessionToLastSession(userDataDir: string): boolean {
  const profileDir = getProfileDir(userDataDir);
  const currentSession = path.join(profileDir, 'Current Session');
  const lastSession = path.join(profileDir, 'Last Session');
  if (!fs.existsSync(currentSession)) {
    log(`  copyCurrentSessionToLastSession: ${currentSession} not found`);
    return false;
  }
  fs.copyFileSync(currentSession, lastSession);
  log(`  Copied ${currentSession} -> ${lastSession}`);
  return true;
}

export function markProfileCrashed(userDataDir: string): void {
  const profileDir = getProfileDir(userDataDir);
  const prefsPath = path.join(profileDir, 'Preferences');
  let prefs: any = {};
  if (fs.existsSync(prefsPath)) {
    try {
      prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
    } catch {
      prefs = {};
    }
  }
  prefs.profile = prefs.profile || {};
  prefs.profile.exit_type = 'Crashed';
  prefs.profile.exited_cleanly = false;
  fs.writeFileSync(prefsPath, JSON.stringify(prefs));
  log(`  Marked profile as crashed in ${prefsPath}`);
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
    args.push('--hide-crash-restore-bubble');
  }

  return puppeteer.launch({
    headless: false,
    userDataDir,
    args,
    defaultViewport: null,
  });
}
