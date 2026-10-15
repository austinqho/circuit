// G5 per-repository session: anything-llm, the demo scenario (docs/gates/G5-demo.md §3.2).
// Harness code: it may know this repository's UI; nothing here is part of the package.
//
// Create a workspace, open its settings, rename it three times (OK, 422 from
// the seeded update handler, OK), then make "Update Workspace" visible again
// and annotate it the way Codex's manual annotation would. No LLM key needed.
import fs from 'node:fs';
import path from 'node:path';
import base from './anything-llm.mjs';
import { annotateElement } from '../g5-annotation.mjs';

export const ATTEMPTS = [
  { name: 'tracer-g5-first', expect: 200 },
  { name: 'Tracer G5 second', expect: 422 }, // whitespace → the seeded 422
  { name: 'tracer-g5-third', expect: 200 },
];

export default {
  ...base,
  name: 'anything-llm-g5',
  async run({ page, step, log, out, packageDir }) {
    await page.locator('button[data-tooltip-id="new-workspace-tooltip"]').first().waitFor({ state: 'visible', timeout: 20000 });
    await step('open-new-workspace', 'click the sidebar "+" (New Workspace) button', async () => {
      await page.locator('button[data-tooltip-id="new-workspace-tooltip"]').first().click();
      await page.locator('form input#name').waitFor({ state: 'visible', timeout: 5000 });
    });
    await step('create-workspace', 'type "Tracer G5" into the workspace name field and click Save', async () => {
      const name = page.locator('form input#name');
      await name.click(); await name.pressSequentially('Tracer G5', { delay: 20 });
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await page.waitForURL(/\/workspace\//u, { timeout: 10000 });
    }, { settleMs: 1500 });
    await step('open-workspace-settings', 'click the workspace gear (General appearance settings)', async () => {
      await page.locator('button[aria-label="General appearance settings"]').first().click();
      await page.waitForURL(/\/settings\//u, { timeout: 10000 });
      await page.locator('form input[name="name"]').waitFor({ state: 'visible', timeout: 10000 });
    }, { settleMs: 1500 });

    const attempts = [];
    const nameField = page.locator('form input[name="name"]');
    const updateButton = page.getByRole('button', { name: 'Update Workspace' });
    for (const [index, attempt] of ATTEMPTS.entries()) {
      await step(`rename-attempt-${index + 1}`, `replace the workspace name with "${attempt.name}" and click Update Workspace (expect ${attempt.expect})`, async () => {
        await nameField.click(); await page.keyboard.press('ControlOrMeta+A'); await nameField.pressSequentially(attempt.name, { delay: 15 });
        await updateButton.waitFor({ state: 'visible', timeout: 5000 });
        const response = page.waitForResponse(res => /\/api\/workspace\/[^/]+\/update$/u.test(new URL(res.url()).pathname) && res.request().method() === 'POST', { timeout: 10000 });
        await updateButton.click();
        const settled = await response;
        attempts.push({ attempt: index + 1, name: attempt.name, expect: attempt.expect, observed_status: settled.status(), method: settled.request().method(), url: new URL(settled.url()).pathname, at: Date.now() });
        await page.waitForTimeout(600); // let the toast render for the screenshot
      }, { settleMs: 1200 });
    }
    fs.writeFileSync(path.join(out, 'attempts.json'), JSON.stringify(attempts, null, 2));
    log('attempts', JSON.stringify(attempts.map(row => `${row.attempt}:${row.observed_status}`)));

    await step('annotate-update-button', 'type one character so Update Workspace renders again, then annotate it (Codex manual annotation, gate off)', async () => {
      await nameField.click(); await page.keyboard.press('End'); await nameField.pressSequentially('x', { delay: 15 });
      await updateButton.waitFor({ state: 'visible', timeout: 5000 });
      await annotateElement({ page, locator: updateButton, out, packageDir, log });
    }, { settleMs: 800 });
  },
};
