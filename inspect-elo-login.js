#!/usr/bin/env node
'use strict';
const { chromium } = require('playwright');
const path = require('path');

async function inspectLoginForm() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  console.log('Opening https://community.elo.com/...');
  await page.goto('https://community.elo.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

  console.log('\n=== LOGIN FORM STRUCTURE ===\n');

  // Get all input fields
  const inputs = await page.$$eval('input', els =>
    els.map(el => ({
      type: el.type,
      id: el.id,
      name: el.name,
      placeholder: el.placeholder,
      class: el.className,
      autocomplete: el.autocomplete,
      ariaLabel: el.getAttribute('aria-label'),
      selector: el.id ? `#${el.id}` : el.name ? `input[name="${el.name}"]` : el.className ? `.${el.className.split(' ')[0]}` : 'input'
    }))
  );

  console.log('INPUT FIELDS:');
  inputs.forEach((inp, i) => {
    console.log(`${i}) Type: ${inp.type}, ID: ${inp.id || 'none'}, Name: ${inp.name || 'none'}`);
    console.log(`   Placeholder: "${inp.placeholder || 'none'}"`);
    console.log(`   Class: "${inp.class || 'none'}"`);
    console.log(`   Autocomplete: ${inp.autocomplete || 'none'}`);
    console.log(`   Aria-label: ${inp.ariaLabel || 'none'}`);
    console.log(`   Best selector: ${inp.selector}\n`);
  });

  // Get all buttons
  const buttons = await page.$$eval('button', els =>
    els.map(el => ({
      type: el.type,
      text: el.textContent.trim().slice(0, 50),
      id: el.id,
      class: el.className,
      ariaLabel: el.getAttribute('aria-label'),
      selector: el.id ? `#${el.id}` : el.className ? `.${el.className.split(' ')[0]}` : 'button'
    }))
  );

  console.log('\nBUTTON ELEMENTS:');
  buttons.forEach((btn, i) => {
    console.log(`${i}) Type: ${btn.type}, Text: "${btn.text}"`);
    console.log(`   ID: ${btn.id || 'none'}, Class: ${btn.class || 'none'}`);
    console.log(`   Aria-label: ${btn.ariaLabel || 'none'}`);
    console.log(`   Best selector: ${btn.selector}\n`);
  });

  // Get login form container
  const form = await page.$('form').catch(() => null);
  if (form) {
    const formHtml = await form.evaluate(el => el.outerHTML.slice(0, 1000));
    console.log('\nFORM HTML (first 1000 chars):');
    console.log(formHtml);
  }

  // Check for specific patterns
  const emailInputs = await page.$$('input[type="email"]');
  const passwordInputs = await page.$$('input[type="password"]');
  const submitButtons = await page.$$('button[type="submit"]');

  console.log(`\nFOUND:
- Email inputs: ${emailInputs.length}
- Password inputs: ${passwordInputs.length}
- Submit buttons: ${submitButtons.length}
`);

  console.log('\n=== SUGGESTED SELECTORS ===');
  console.log(`usernameField: "input[type='email'], input[type='text'][autocomplete='username']"`);
  console.log(`passwordField: "input[type='password']"`);
  console.log(`submitButton: "button[type='submit']"`);
  console.log(`loggedInIndicator: ".user-profile, [data-test='user-menu'], .logout-btn"`);

  console.log('\nKeep browser open. Close manually when done inspecting.');
  // Don't close - keep browser open for inspection
}

inspectLoginForm().catch(console.error);
