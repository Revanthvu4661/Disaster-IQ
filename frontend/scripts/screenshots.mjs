/**
 * Capture every page at desktop and mobile width.
 *
 *   node scripts/screenshots.mjs [baseUrl] [outDir]
 *
 * Defaults to http://localhost:5173 and docs/screenshots. Both servers must be
 * running. Each page is also checked for horizontal overflow and console
 * errors, which are printed as warnings.
 */

import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const BASE = process.argv[2] ?? 'http://localhost:5173'
const OUT = process.argv[3] ?? path.join('docs', 'screenshots')

const PAGES = [
  { slug: 'dashboard', path: '/' },
  { slug: 'insights', path: '/insights' },
  { slug: 'predict', path: '/predict' },
  { slug: 'triage', path: '/triage' },
  { slug: 'hazards', path: '/hazards' },
  { slug: 'model', path: '/model' },
  { slug: 'about', path: '/about' },
]

const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'mobile', width: 360, height: 780 },
]

const SAMPLE_MESSAGE =
  'We are trapped under a collapsed building in Leogane, several people are injured and we have no water'

const BATCH = [
  'We are trapped under a collapsed house in Leogane and two people are injured',
  'We need drinking water and food for fifty families at the school',
  'The river burst its banks in Sindh, we need boats to evacuate the village',
  'Power is out across Staten Island and the basement is flooded',
  'A fire has started in the market and is spreading fast',
  'My brother is missing since the earthquake, please help me find him',
].join('\n')

/** Pages that need an interaction before they show anything interesting. */
async function prepare(page, slug) {
  if (slug === 'predict') {
    await page.fill('#message', SAMPLE_MESSAGE)
    await page.getByRole('button', { name: /classify message/i }).click()
    await page.getByRole('img', { name: /severity/i }).waitFor({ timeout: 60_000 })
  }
  if (slug === 'triage') {
    await page.fill('#batch-text', BATCH)
    await page.getByRole('button', { name: /triage \d+ messages/i }).click()
    await page.getByText(/severity breakdown/i).waitFor({ timeout: 60_000 })
  }
  // Charts below the fold mount on intersection, so scroll the whole page
  // before capturing and return to the top.
  await page.evaluate(async () => {
    const step = window.innerHeight * 0.8
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y)
      await new Promise((resolve) => setTimeout(resolve, 120))
    }
    window.scrollTo(0, 0)
  })
  await page.waitForTimeout(1200)
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const browser = await chromium.launch()
  let failures = 0

  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 2,
      colorScheme: 'dark',
    })
    for (const target of PAGES) {
      const page = await context.newPage()
      const errors = []
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text())
      })
      try {
        await page.goto(BASE + target.path, { waitUntil: 'networkidle', timeout: 60_000 })
        await prepare(page, target.slug)

        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth + 1,
        )
        if (overflow) {
          failures += 1
          console.warn(`  ! ${target.slug} (${viewport.name}) scrolls horizontally`)
        }
        if (errors.length) {
          failures += 1
          console.warn(`  ! ${target.slug} (${viewport.name}) console errors: ${errors[0]}`)
        }

        const file = path.join(OUT, `${target.slug}-${viewport.name}.png`)
        await page.screenshot({ path: file, fullPage: viewport.name === 'desktop' })
        console.log(`  ok ${file}`)
      } catch (error) {
        failures += 1
        console.error(`  ! ${target.slug} (${viewport.name}) failed: ${error.message}`)
      } finally {
        await page.close()
      }
    }
    await context.close()
  }

  // One light-theme capture, to prove both themes are real.
  const light = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: 'light',
  })
  const page = await light.newPage()
  await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 60_000 })
  await page.waitForTimeout(1500)
  await page.screenshot({ path: path.join(OUT, 'dashboard-light.png'), fullPage: true })
  console.log(`  ok ${path.join(OUT, 'dashboard-light.png')}`)
  await light.close()

  await browser.close()
  console.log(failures === 0 ? 'All pages captured cleanly.' : `${failures} warning(s).`)
  process.exitCode = 0
}

main()
