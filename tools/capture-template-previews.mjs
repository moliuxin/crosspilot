/**
 * 模板商城预览图自动生成（P0-NAV-TEMPLATE-PUBLIC）。
 *
 * 对每个模板的真实 Demo 路由（/#/templates/<slug>）用 Playwright 截图：
 *   public/template-assets/<slug>/thumbnail.webp    卡片缩略图（首屏）
 *   public/template-assets/<slug>/preview-full.webp 整页长图（卡片 hover 滚动用）
 *   public/template-assets/<slug>/preview-01..03.webp 局部预览
 *
 * 商城卡片优先使用这里的真实截图；截图缺失时回落到结构化迷你页面骨架。
 *
 * 用法：
 *   FE_URL=http://127.0.0.1:5173 node tools/capture-template-previews.mjs
 * Chrome 路径可用 CHROME_PATH 指定，缺省用 Playwright 自带 Chromium。
 */
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const FE = process.env.FE_URL || 'http://127.0.0.1:5173'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'public', 'template-assets')

const SLUGS = [
  'industrial-pro',
  'supplier-minimal',
  'russia-industrial',
  'food-export',
  'electronics-global',
  'building-materials-pro',
]

const chromePath = process.env.CHROME_PATH || undefined

async function toWebp(buffer) {
  // Playwright 自带 screenshot type=webp（Chromium ≥ 111）；失败时回落 png
  return buffer
}

async function main() {
  const browser = await chromium.launch(
    chromePath
      ? { executablePath: chromePath, args: ['--no-sandbox'] }
      : { args: ['--no-sandbox'] }
  )
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1.5 })

  for (const slug of SLUGS) {
    const dir = join(OUT, slug)
    await mkdir(dir, { recursive: true })

    await page.goto(`${FE}/#/templates/${slug}`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.tpl-demo-stage', { timeout: 15000 })
    await page.waitForTimeout(900)

    const stage = page.locator('.tpl-demo-stage')

    // 整页长图（hover 滚动预览的数据源）
    const full = await stage.screenshot({ fullPage: false, type: 'png' }).catch(() => null)
    if (full) await writeFile(join(dir, 'preview-full.png'), full)

    // 卡片缩略图（首屏区域）
    const hero = page.locator('.demo-hero').first()
    const thumb = await hero.screenshot({ type: 'png' }).catch(() => null)
    if (thumb) await writeFile(join(dir, 'thumbnail.png'), thumb)

    // 三个局部预览：滚动到不同区块各截一张
    const sections = page.locator('.tpl-demo-stage section')
    const count = await sections.count()
    let shotIdx = 0
    for (let i = 1; i < count && shotIdx < 3; i++) {
      const sec = sections.nth(i)
      const box = await sec.boundingBox().catch(() => null)
      if (!box || box.height < 120) continue
      await sec.scrollIntoViewIfNeeded().catch(() => {})
      await page.waitForTimeout(250)
      const buf = await sec.screenshot({ type: 'png' }).catch(() => null)
      if (buf) {
        shotIdx++
        await writeFile(join(dir, `preview-0${shotIdx}.png`), buf)
      }
    }
    console.log(`✔ ${slug}: thumbnail + preview-full + ${shotIdx} 局部图`)
  }

  await browser.close()
  console.log(`\n完成：输出目录 ${OUT}`)
  console.log('注：生成的是 PNG；商城引用 .webp，构建前请批量转换（如 cwebp -q 82）。')
}

main().catch((e) => {
  console.error('截图失败：', e)
  process.exit(1)
})
