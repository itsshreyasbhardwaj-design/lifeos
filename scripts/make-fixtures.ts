/** Renders the test fixtures (a text screenshot PNG and a receipt PDF) with Chromium. */
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 230 } });
await page.setContent('<body style="margin:0;background:#fff"><div style="padding:40px;font:36px/1.5 Arial;color:#000"><div>Reminder from Green Valley School</div><div>Pay the term fees by 28/11/2026 at 5pm</div></div></body>');
writeFileSync('tests/fixtures/screenshot.png', await page.screenshot({ type: 'png' }));
await page.setContent('<body style="font:14px Arial;padding:24px"><h2>Croma</h2><p>Tax Invoice</p><p>Invoice No: CRM/26/55120</p><p>Invoice Date: 15/11/2026</p><p>Item: Sony WH-1000XM5 Headphones Qty 1 ₹29,990.00</p><p>Grand Total ₹29,990.00</p><p>1 year manufacturer warranty.</p><p>7 days replacement policy.</p></body>');
writeFileSync('tests/fixtures/receipt.pdf', await page.pdf({ format: 'A5' }));
await browser.close();
console.log('fixtures written');
