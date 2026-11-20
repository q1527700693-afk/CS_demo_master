import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

// Native modules live outside Vite's hashed chunks. Version every edge, including
// dynamic renderer imports, so an older browser cache cannot mix releases.
export function stampTrainingImports(source, revision) {
  const stamp = (_match, prefix, quote, path) => `${prefix}${quote}${path}?revision=${encodeURIComponent(revision)}${quote}`
  return source
    .replace(/(\b(?:from\s*|import\s*\(\s*|import\s*))(['"])(\.{1,2}\/[^'"]+\.js)(?:\?[^'"]*)?\2/g, stamp)
    .replace(/(\bnew URL\(\s*)(['"])(\.{1,2}\/[^'"]+\.css)(?:\?[^'"]*)?\2/g, stamp)
}

export async function versionTrainingRuntime(output, revision) {
  const files = [join(output, 'training-loader.js')]
  async function visit(folder) {
    for (const item of await readdir(folder, { withFileTypes: true })) {
      const path = join(folder, item.name)
      if (item.isDirectory()) await visit(path)
      else if (item.name.endsWith('.js')) files.push(path)
    }
  }
  await visit(join(output, 'vector-trainer'))
  for (const path of files) {
    const source = await readFile(path, 'utf8')
    const published = stampTrainingImports(source, revision)
    if (published !== source) await writeFile(path, published)
  }
}
