import { chromium } from 'playwright';

async function testCrawl() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Docraider-MCP/1.0',
  });
  
  const page = await context.newPage();
  
  // Test a site that should work (python.org docs)
  const testUrl = 'https://docs.python.org/3/library/os.html';
  
  console.log(`Testing crawl: ${testUrl}`);
  
  try {
    const response = await page.goto(testUrl, { waitUntil: 'networkidle' });
    console.log(`Response status: ${response.status()}`);
    
    // Wait for main content
    await page.waitForSelector('article, main, [role="main"], .content, .doc-content', {
      timeout: 5000,
    }).catch(() => {});
    
    const title = await page.title();
    console.log(`Title: ${title}`);
    
    // Extract links
    const links = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('a[href]'))
        .map(a => a.href)
        .filter(href => href.startsWith('http'));
    });
    
    console.log(`Found ${links.length} links`);
    
    // Filter to same domain
    const baseDomain = new URL(testUrl).hostname;
    const discoveredLinks = [];
    for (const link of links) {
      try {
        const parsed = new URL(link);
        parsed.hash = '';
        const cleanUrl = parsed.toString();
        if (parsed.hostname === baseDomain && !cleanUrl.endsWith('#')) {
          discoveredLinks.push(cleanUrl);
        }
      } catch {
        // ignore invalid URLs
      }
    }
    
    console.log(`Discovered ${discoveredLinks.length} links on same domain`);
    console.log(`Sample links: ${discoveredLinks.slice(0, 5).join(', ')}`);
    
  } catch (error) {
    console.log(`Error: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await context.close();
    await browser.close();
  }
}

testCrawl();