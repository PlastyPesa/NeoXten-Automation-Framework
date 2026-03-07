import puppeteer from 'puppeteer-core';

const version = await fetch('http://127.0.0.1:9222/json/version').then((r) => r.json());
console.log('version', version);

const targets = await fetch('http://127.0.0.1:9222/json/list').then((r) => r.json());
console.log('targets', targets);

// Try browser target first (from /json/version)
const browserWs = version.webSocketDebuggerUrl;
console.log('browser ws', browserWs);

const browser = await puppeteer.connect({
  browserWSEndpoint: browserWs,
  protocolTimeout: 30000,
});
console.log('connected');
const pages = await browser.pages();
console.log('pages', pages.length);
if (pages[0]) {
  console.log('url', await pages[0].url());
  console.log('title', await pages[0].title());
}
await browser.disconnect();
console.log('done');
