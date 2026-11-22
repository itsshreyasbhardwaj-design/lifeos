import { captureItem } from './lib.js';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'lifeos-selection', title: 'Save selection to LifeOS', contexts: ['selection'] });
  chrome.contextMenus.create({ id: 'lifeos-link', title: 'Save link to LifeOS', contexts: ['link'] });
  chrome.contextMenus.create({ id: 'lifeos-page', title: 'Save this page to LifeOS', contexts: ['page'] });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    if (info.menuItemId === 'lifeos-selection') await captureItem({ text: info.selectionText, url: tab?.url, title: tab?.title });
    else if (info.menuItemId === 'lifeos-link') await captureItem({ url: info.linkUrl, title: tab?.title ? `Link from ${tab.title}` : null });
    else await captureItem({ url: tab?.url, title: tab?.title });
    chrome.action.setBadgeText({ text: '✓', tabId: tab?.id });
  } catch (e) {
    chrome.action.setBadgeText({ text: '!', tabId: tab?.id });
    console.warn('LifeOS:', e.message);
  }
  setTimeout(() => chrome.action.setBadgeText({ text: '', tabId: tab?.id }), 3000);
});
