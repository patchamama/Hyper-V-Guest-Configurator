'use strict';
// Post-install checks in a headless browser:
//  - acceptEula(): sign in to the Admin Console as the ELO administrator and accept the end-user license
//    agreement (tick the checkbox + OK) if it is shown on first login. Only run with the user's consent (wizard option).
//  - webClientCheck(): open the Web Client and report whether it is usable or blocked ("No license detected").
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require(require('path').join(__dirname, '..', '..', '..', 'node_modules', 'playwright'))); }

async function signIn(page, url, user, pass) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 90000 });
  const u = await page.$('input[name=username], input#username');
  const p = await page.$('input[type=password]');
  if (u && p) {
    await u.fill(user); await p.fill(pass);
    await Promise.all([page.waitForLoadState('networkidle').catch(() => {}), p.press('Enter')]);
    await page.waitForTimeout(4000);
  }
  if (/sign-in/.test(page.url())) {
    const msg = await page.evaluate(() => (document.querySelector('[class*=error], [role=alert]')?.innerText || '').trim());
    throw new Error(`login failed${msg ? ': ' + msg : ''}`);
  }
}

async function acceptEula({ base, repo, user, pass, screenshot }) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
    await signIn(page, `${base}/${repo}/plugin/de.elo.ix.plugin.proxy/ac/`, user, pass);
    let accepted = false;
    if (/eula/i.test(page.url())) {
      // The agreement checkbox is the only one on the page (label "I have read … EULA" / "Ich habe … gelesen").
      const box = await page.$('input[type=checkbox]') || await page.$('[role=checkbox], .ui-chkbox-box');
      if (!box) throw new Error('EULA page without checkbox');
      await box.click();
      const ok = await page.$('button:has-text("OK"), input[type=submit][value="OK"], a:has-text("OK")');
      if (!ok) throw new Error('EULA OK button not found');
      await Promise.all([page.waitForLoadState('networkidle').catch(() => {}), ok.click()]);
      await page.waitForTimeout(4000);
      if (/eula/i.test(page.url())) throw new Error('EULA still shown after OK');
      accepted = true;
    }
    if (screenshot) await page.screenshot({ path: screenshot });
    return { ok: true, accepted, alreadyAccepted: !accepted, page: new URL(page.url()).pathname };
  } finally { await browser.close(); }
}

async function webClientCheck({ base, repo, user, pass, screenshot }) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
    await page.goto(`${base}/${repo}/plugin/de.elo.ix.plugin.proxy/web/`, { waitUntil: 'networkidle', timeout: 90000 });
    const text = await page.evaluate(() => document.body.innerText || '');
    if (/no licen[cs]e detected/i.test(text)) {
      if (screenshot) await page.screenshot({ path: screenshot });
      return { ok: false, reason: 'license', message: 'The ELO license has no Web Client server/user licenses ("No license detected").' };
    }
    if (await page.$('input[type=password]')) await signIn(page, page.url(), user, pass);
    await page.waitForTimeout(6000);
    if (screenshot) await page.screenshot({ path: screenshot });
    const after = await page.evaluate(() => document.body.innerText || '');
    if (/no licen[cs]e detected/i.test(after)) return { ok: false, reason: 'license', message: 'Web Client blocked: no Web Client license.' };
    return { ok: true, title: await page.title() };
  } finally { await browser.close(); }
}

module.exports = { acceptEula, webClientCheck };
