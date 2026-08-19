import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

const urls = [
  'https://neo4j.com/docs/',
  'https://neo4j.com/docs/cypher-manual/4/',
];

for (const url of urls) {
  console.log(`\n=== Testing: ${url} ===`);
  
  try {
    const startTime = Date.now();
    const response = await page.goto(url, { waitUntil: 'networkidle' });
    const networkTime = Date.now() - startTime;
    
    console.log(`Response status: ${response.status()}`);
    console.log(`Network idle time: ${networkTime}ms`);
    
    // Check page title
    const title = await page.title();
    console.log(`Page title: ${title}`);
    
    // Get content height
    const contentHeight = await page.evaluate(() => {
      return {
        bodyHeight: document.body?.scrollHeight || 0,
        mainHeight: document.querySelector('main, [role="main"], article')?.offsetHeight || 0,
      };
    });
    console.log(`Content height: ${contentHeight.bodyHeight}px`);
    console.log(`Main content height: ${contentHeight.mainHeight}px`);
    
    // Get visible text length
    const textLength = await page.evaluate(() => {
      return document.body?.innerText?.length || 0;
    });
    console.log(`Visible text length: ${textLength} characters`);
    
    // Check for common JS-rendered content patterns
    const jsIndicators = await page.evaluate(() => {
      return {
        hasReact: !!window.__NEXT_DATA__ || !!window.__REACT_DEVTOOLS_GLOBAL_HOOK__,
        hasVue: !!window.__VUE__,
        hasAngular: !!window.angular,
        hasHydrate: !!document.querySelector('#__next, #__nuxt, #__app'),
        hasDataAttributes: document.querySelectorAll('[data-testid], [data-component]').length,
      };
    });
    console.log('JS indicators:', jsIndicators);
    
    // Get HTML length
    const html = await page.content();
    console.log(`HTML length: ${html.length} characters`);
    
    // Check for footer-only content (common issue with JS sites)
    const footerContent = await page.evaluate(() => {
      const footers = document.querySelectorAll('footer, [role="contentinfo"]');
      return footers.length;
    });
    console.log(`Footer elements: ${footerContent}`);
    
  } catch (error) {
    console.log(`Error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

await browser.close();
