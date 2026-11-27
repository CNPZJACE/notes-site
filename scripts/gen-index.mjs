// 构建前扫描 content/，自动生成首页 index.md。
// 首页不再是手写表格：新增/删除笔记后，索引自动跟着变。
// 用法: node scripts/gen-index.mjs <contentDir>
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const contentDir = process.argv[2] || "content";
const SKIP_DIRS = new Set(["tags", "private", "templates", ".obsidian"]);

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(p, acc);
    } else if (name.endsWith(".md")) {
      acc.push(p);
    }
  }
  return acc;
}

function readMeta(file) {
  const raw = readFileSync(file, "utf8");
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const meta = {};
  if (m) {
    for (const line of m[1].split(/\r?\n/)) {
      const kv = line.match(/^([a-zA-Z_]+):\s*(.+)$/);
      if (kv) meta[kv[1]] = kv[2].replace(/^["']|["']$/g, "").trim();
    }
  }
  if (!meta.description) {
    const body = m ? raw.slice(m[0].length) : raw;
    for (const line of body.split(/\r?\n/)) {
      const t = line.replace(/^[#>\-*\s]+/, "").replace(/[`*_[\]]/g, "").trim();
      if (t.length >= 12 && !t.startsWith("```") && !/^</.test(t)) {
        meta.description = t.length > 70 ? t.slice(0, 70) + "…" : t;
        break;
      }
    }
  }
  return meta;
}

const files = walk(contentDir).filter((f) => !/index\.md$/i.test(f));
const groups = new Map();

for (const f of files) {
  const rel = relative(contentDir, f);
  const parts = rel.split(sep);
  const top = parts.length > 1 ? parts[0] : "根目录";
  const meta = readMeta(f);
  const title = meta.title || parts[parts.length - 1].replace(/\.md$/i, "");
  const desc = meta.description || "";
  if (!groups.has(top)) groups.set(top, []);
  groups.get(top).push({ title, desc, path: rel.split(sep).join("/").replace(/\.md$/i, "") });
}

const order = [...groups.keys()].sort((a, b) => {
  if (a === "根目录") return 1;
  if (b === "根目录") return -1;
  return a.localeCompare(b, "zh");
});

const total = files.length;
const lines = [
  "---",
  'title: "JC\'s Learn"',
  'description: "JC 的个人学习笔记与知识库"',
  "tags:",
  "  - MOC",
  "  - index",
  "---",
  "",
  "# JC's Learn",
  "",
  "个人学习笔记与知识库总入口。本页由构建时自动生成，按目录汇总全部笔记——新增或删除笔记后会自动更新，无需手工维护。",
  "",
  `> [!info] 当前共 ${total} 篇笔记，${groups.size} 个分区。搜索用左上角输入框，也可以从左侧目录逐层进入。`,
  "",
];

for (const top of order) {
  const items = groups.get(top).sort((a, b) => a.title.localeCompare(b.title, "zh"));
  lines.push(`## ${top}`, "");
  lines.push("| 笔记 | 说明 |", "| --- | --- |");
  for (const it of items) {
    const desc = (it.desc || "").replace(/\|/g, "\\|").slice(0, 80);
    lines.push(`| [[${it.path}\\|${it.title}]] | ${desc} |`);
  }
  lines.push("");
}

lines.push("---", "", "相关：[[index]]", "");

writeFileSync(join(contentDir, "index.md"), lines.join("\n"), "utf8");
console.log(`[gen-index] 生成 index.md：${total} 篇笔记 / ${groups.size} 个分区`);
