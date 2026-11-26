"""Loads the web app in headless Chrome against the real APIs and records what a phone would see."""
import asyncio, json, sys
from playwright.async_api import async_playwright

async def main(base):
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2,
                                  geolocation={'latitude': -37.8136, 'longitude': 144.9631}, permissions=['geolocation'])
        page = await ctx.new_page()
        log = []
        page.on('console', lambda m: log.append(f'{m.type}: {m.text}'))
        page.on('pageerror', lambda e: log.append(f'PAGEERROR: {e}'))
        page.on('requestfailed', lambda r: log.append(f'REQFAIL: {r.url.split("?")[0]} {r.failure}'))
        page.on('requestfinished', lambda r: log.append(f'OK: {r.url.split("?")[0]}'))
        page.on('response', lambda r: log.append(f'HTTP {r.status}: {r.url.split("?")[0]}') if r.status >= 400 else None)
        await page.goto(base + '/index.html')
        try:
            await page.wait_for_selector('#p-core .core', timeout=60000)
        except Exception as e:
            log.append(f'NO FORECAST: {e}')
        await page.wait_for_timeout(8000)
        label = await page.text_content('#liveLabel')
        log.append(f'LABEL: {label}')
        for i, t in enumerate(['core', 'scan', 'traj', 'data', 'golf', 'air']):
            await page.click(f'#dock button[data-tab="{i}"]')
            await page.wait_for_timeout(1200)
            await page.screenshot(path=f'shots/web_{i}_{t}.png')
        if await page.locator('[data-gtab="FLIGHT"]').count():
            await page.click('[data-gtab="FLIGHT"]'); await page.wait_for_timeout(600)
            await page.screenshot(path='shots/web_7_flight.png')
        open('shots/web_console.txt', 'w').write('\n'.join(log))
        print('\n'.join(log))
        await b.close()
        if any(l.startswith(('PAGEERROR', 'NO FORECAST')) for l in log): sys.exit(1)

asyncio.run(main(sys.argv[1]))
