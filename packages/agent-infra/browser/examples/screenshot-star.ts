/*
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { LocalBrowser } from '../src';

function sleep(time: number) {
  return new Promise(function (resolve) {
    setTimeout(resolve, time);
  });
}

async function main() {
  const browser = new LocalBrowser();
  await browser.launch({ headless: false });
  const page = await browser.createPage();
  await page.goto(
    'https://star-history.com/#neura-ai/Neura Desktop&neura-ai/Neura&Date',
    { waitUntil: 'networkidle2' },
  );
  await page.waitForSelector('#capture');
  await sleep(2000);
  await page.screenshot({ path: './Neura Desktop-star-history.png' });
  await page.close();
  await browser.close();
}

main();
