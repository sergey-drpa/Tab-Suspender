import { log } from './BrowserHelper.js';

export interface TestRunner {
  assert(condition: boolean, label: string): void;
  softAssert(condition: boolean, label: string): boolean;
  section(title: string): void;
  summarize(): void;
  hasFailed(): boolean;
  readonly passed: number;
  readonly failed: number;
}

export function createTestRunner(): TestRunner {
  let _passed = 0;
  let _failed = 0;
  const issues: string[] = [];

  return {
    get passed() { return _passed; },
    get failed() { return _failed; },

    assert(condition: boolean, label: string): void {
      if (!condition) {
        _failed++;
        issues.push(label);
        console.error(`  ✗ FAIL  ${label}`);
        throw new Error(`Assertion failed: ${label}`);
      }
      _passed++;
      log(`  ✓ PASS  ${label}`);
    },

    softAssert(condition: boolean, label: string): boolean {
      if (!condition) {
        _failed++;
        issues.push(label);
        console.warn(`  ✗ WARN  ${label}`);
      } else {
        _passed++;
        log(`  ✓ PASS  ${label}`);
      }
      return condition;
    },

    section(title: string): void {
      log(`\n──── ${title} ────`);
    },

    summarize(): void {
      log('');
      log(`══════════════════════════════════════════════`);
      log(`  RESULT  ${_passed} passed  /  ${_failed} failed`);
      log(`══════════════════════════════════════════════`);
      if (issues.length > 0) {
        log('\n  Failed checks:');
        issues.forEach(i => log(`    • ${i}`));
      }
    },

    hasFailed(): boolean { return _failed > 0; },
  };
}
