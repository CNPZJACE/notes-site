// 构建后把第三方 CDN 资源下载到 public/static/vendor 并改写引用，避免境内访问 jsdelivr 超时。
// 用法：node scripts/localize-cdn.mjs [publicDir]（默认 public）
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import path from "node:path"

const publicDir = process.argv[2] ?? "public"
const vendorDir = path.join(publicDir, "static", "vendor")

// 与页面/脚本中实际引用的版本保持一致；升级插件后若版本变化，同步更新这里。
const assets = [
  { url: "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css", file: "katex.min.css" },
  {
    url: "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/copy-tex.min.js",
    file: "copy-tex.min.js",
  },
  { url: "https://cdn.jsdelivr.net/npm/d3@7.9.2/dist/d3.min.js", file: "d3.min.js" },
  { url: "https://cdn.jsdelivr.net/npm/pixi.js@8.23.0/dist/pixi.min.js", file: "pixi.min.js" },
]

async function fetchRetry(url, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60_000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res
    } catch (e) {
      if (i >= tries) throw new Error(`下载失败 ${url}: ${e.message}`)
      console.warn(`retry ${i} ${url}`)
    }
  }
}

await mkdir(vendorDir, { recursive: true })
for (const { url, file } of assets) {
  const res = await fetchRetry(url)
  await writeFile(path.join(vendorDir, file), Buffer.from(await res.arrayBuffer()))
  console.log(`vendorized ${file}`)
}

// KaTeX 样式内部以相对路径引用 fonts/，一并下载，保持相对结构不变。
const css = await readFile(path.join(vendorDir, "katex.min.css"), "utf8")
const fontUrls = [
  ...new Set([...css.matchAll(/url\((fonts\/[^)#?]+)(?:[)#?][^)]*)?\)/g)].map((m) => m[1])),
]
await mkdir(path.join(vendorDir, "fonts"), { recursive: true })
for (const f of fontUrls) {
  const res = await fetchRetry(`https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/${f}`)
  await writeFile(path.join(vendorDir, f), Buffer.from(await res.arrayBuffer()))
}
console.log(`vendorized ${fontUrls.length} katex font files`)

async function* walk(dir) {
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) yield* walk(p)
    else if (/\.(html|js)$/.test(ent.name)) yield p
  }
}

let changed = 0
for await (const p of walk(publicDir)) {
  let text = await readFile(p, "utf8")
  const orig = text
  // HTML：绝对地址改站点根绝对路径（页面嵌套深度不一，不能用相对路径）。
  text = text.replaceAll(
    "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/copy-tex.min.js",
    "/static/vendor/copy-tex.min.js",
  )
  text = text.replaceAll("https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/", "/static/vendor/")
  // mermaid 渲染器优先用随包本地资源，CDN 仅是回退；一并指向本地，消除死外链。
  text = text.replaceAll(
    "https://cdn.jsdelivr.net/npm/pele@1.13.0/dist/esm/lazy.js",
    "/static/plugins/obsidian-flavored-markdown/pele/lazy.js",
  )
  // JS：图谱加载器按完整 URL（含 ?integrity=… 查询串）匹配已有 script 标签，
  // 因此只替换 origin+路径前缀、保留查询串，并让 HTML 注入同样的查询串。
  text = text.replaceAll(
    "https://cdn.jsdelivr.net/npm/d3@7.9.2/dist/d3.min.js",
    "/static/vendor/d3.min.js",
  )
  text = text.replaceAll(
    "https://cdn.jsdelivr.net/npm/pixi.js@8.23.0/dist/pixi.min.js",
    "/static/vendor/pixi.min.js",
  )
  if (text !== orig) {
    await writeFile(p, text)
    changed++
  }
}
console.log(`rewrote ${changed} files`)
