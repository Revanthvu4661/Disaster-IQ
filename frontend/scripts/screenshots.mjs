/**
 * Capture every primary page at 1280 px and 360 px, in dark and light themes.
 *
 *   node scripts/screenshots.mjs [baseUrl] [outDir] [--only=slug,slug]
 *
 * Defaults to http://localhost:5173 and docs/screenshots. Both servers must be
 * running. Each capture is also checked for horizontal overflow, console
 * errors and skeletons that never resolved, which are printed as warnings.
 */

import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const args = process.argv.slice(2).filter((arg) => !arg.startsWith('--'))
const only = process.argv.find((arg) => arg.startsWith('--only='))?.slice(7).split(',')
const BASE = args[0] ?? 'http://localhost:5173'
const OUT = args[1] ?? path.join('docs', 'screenshots')

const PAGES = [
  { slug: 'overview', path: '/' },
  { slug: 'earthquake', path: '/earthquake' },
  { slug: 'flood', path: '/flood' },
  { slug: 'cyclone', path: '/cyclone' },
  { slug: 'map', path: '/map' },
  { slug: 'risk-flood', path: '/risk?type=flood' },
  { slug: 'risk-earthquake', path: '/risk?type=earthquake' },
  { slug: 'risk-cyclone', path: '/risk?type=cyclone' },
  { slug: 'preparedness-flood', path: '/preparedness?type=flood' },
  { slug: 'preparedness-earthquake', path: '/preparedness?type=earthquake' },
  { slug: 'preparedness-cyclone', path: '/preparedness?type=cyclone' },
].filter((page) => !only || only.includes(page.slug))

const VIEWPORTS = [
  { name: '1280', width: 1280, height: 900 },
  { name: '360', width: 360, height: 780 },
]
const THEMES = ['dark', 'light']

async function settle(page) {
  await page.waitForSelector('main h1', { timeout: 30_000 })
  // Scroll through the page so deferred charts mount, then return to the top.
  // Twice: the first pass can finish before the data has made the page tall.
  const scrollThrough = () =>
    page.evaluate(async () => {
      const step = window.innerHeight * 0.8
      for (let y = 0; y < document.body.scrollHeight; y += step) {
        window.scrollTo(0, y)
        await new Promise((resolve) => setTimeout(resolve, 150))
      }
      window.scrollTo(0, 0)
    })
  const noSkeletons = () =>
    page
      .waitForFunction(() => document.querySelectorAll('main .skeleton').length === 0, null, {
        timeout: 45_000,
      })
      .catch(() => {})
  await scrollThrough()
  await noSkeletons() // live feeds can take a few seconds cold
  await scrollThrough()
  await noSkeletons()
  // Maps: wait for the OpenStreetMap tiles, not just the markers.
  if (await page.locator('.leaflet-container').count()) {
    await page
      .waitForFunction(
        () =>
          document.querySelectorAll('.leaflet-tile-loaded').length > 0 &&
          document.querySelectorAll('.leaflet-tile:not(.leaflet-tile-loaded)').length === 0,
        null,
        { timeout: 30_000 },
      )
      .catch(() => console.warn('  ! map tiles did not finish loading'))
  }
  await page.waitForTimeout(1500)
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const browser = await chromium.launch()
  let warnings = 0

  for (const theme of THEMES) {
    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: viewport.width < 500 ? 2 : 1,
        colorScheme: theme,
      })
      await context.addInitScript((value) => {
        try {
          window.localStorage.setItem('disasteriq.theme', value)
        } catch {
          /* ignore */
        }
      }, theme)

      for (const target of PAGES) {
        const page = await context.newPage()
        const errors = []
        page.on('console', (message) => {
          if (message.type() === 'error') errors.push(message.text())
        })
        page.on('pageerror', (error) => errors.push(error.message))
        const label = `${target.slug} ${viewport.name} ${theme}`
        try {
          await page.goto(BASE + target.path, { waitUntil: 'domcontentloaded', timeout: 60_000 })
          await settle(page)

          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth > window.innerWidth + 1,
          )
          if (overflow) {
            warnings += 1
            console.warn(`  ! ${label}: scrolls horizontally`)
          }
          const stuck = await page.evaluate(() => document.querySelectorAll('main .skeleton').length)
          if (stuck) {
            warnings += 1
            console.warn(`  ! ${label}: ${stuck} skeleton(s) never resolved`)
          }
          if (errors.length) {
            warnings += 1
            console.warn(`  ! ${label}: console error: ${errors[0].slice(0, 200)}`)
          }

          const file = path.join(OUT, `${target.slug}-${viewport.name}-${theme}.png`)
          await page.screenshot({ path: file, fullPage: true })
          console.log(`  ok ${file}`)
        } catch (error) {
          warnings += 1
          console.error(`  ! ${label}: failed: ${error.message}`)
        } finally {
          await page.close()
        }
      }
      await context.close()
    }
  }

  await browser.close()
  console.log(warnings === 0 ? 'All pages captured cleanly.' : `${warnings} warning(s).`)
}

main()
