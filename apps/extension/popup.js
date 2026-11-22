import { captureItem, quickTask, saveSettings, settings } from './lib.js';

const $ = (id) => document.getElementById(id);
const status = (msg, error = false) => { $('status').textContent = msg; $('status').className = error ? 'error' : ''; };

async function render() {
  const s = await settings();
  $('setup').hidden = Boolean(s.server && s.token);
  $('main').hidden = !(s.server && s.token);
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function run(fn, done) {
  try { status('Saving…'); await fn(); status(done); }
  catch (e) { status(e.message, true); }
}

$('connect').addEventListener('click', () => run(async () => { await saveSettings($('server').value, $('token').value); await render(); }, 'Connected'));
$('disconnect').addEventListener('click', async () => { await chrome.storage.local.clear(); render(); });
$('save-page').addEventListener('click', () => run(async () => { const t = await activeTab(); await captureItem({ url: t.url, title: t.title }); }, 'Page saved'));
$('save-selection').addEventListener('click', () => run(async () => {
  const t = await activeTab();
  // activeTab: this runs only because you clicked, and only on this tab.
  const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: t.id }, func: () => String(window.getSelection() || '') });
  if (!result.trim()) throw new Error('Select some text on the page first.');
  await captureItem({ text: result, url: t.url, title: t.title });
}, 'Selection saved'));
$('save-note').addEventListener('click', () => run(async () => { const v = $('note').value.trim(); if (!v) throw new Error('Write something first.'); await captureItem({ text: v }); $('note').value = ''; }, 'Saved to Inbox'));
$('save-task').addEventListener('click', () => run(async () => { const v = $('note').value.trim(); if (!v) throw new Error('Write a task first.'); await quickTask(v); $('note').value = ''; }, 'Task added'));

render();
