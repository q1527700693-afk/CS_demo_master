import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const project = fileURLToPath(new URL('../', import.meta.url))
const source = resolve(project, '../training/CSPlatform/aim-trainer')
const destination = resolve(project, 'public/vector-trainer')
const indexPath = join(destination, 'integration-source.json')
const entries = ['src', 'vendor', 'assets', 'styles.css']
const digest = (buffer) => createHash('sha256').update(buffer).digest('hex')
async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

// Never transform or format teammate code. Copy only the runtime, not their
// standalone app entry, service worker, screenshots, tests or browser installs.
if (!(await exists(join(source, 'src/app.js')))) {
  if (await exists(join(destination, 'src/app.js'))) {
    console.log('[training] Source folder absent; using the bundled training snapshot.')
    process.exit(0)
  }
  throw new Error('Training source not found: expected ../training/CSPlatform/aim-trainer')
}

const files = []
async function visit(path) {
  const info = await stat(join(source, path))
  if (info.isDirectory()) {
    for (const name of (await readdir(join(source, path))).sort()) await visit(join(path, name))
    return
  }
  const normalized = path.split(sep).join('/')
  const data = await readFile(join(source, path))
  const target = join(destination, path)
  await mkdir(dirname(target), { recursive: true })
  if (!(await exists(target)) || digest(await readFile(target)) !== digest(data)) {
    await copyFile(join(source, path), target)
  }
  files.push({ path: normalized, bytes: data.length, sha256: digest(data) })
}
for (const entry of entries) await visit(entry)

// Prune only individual files previously created by this script. Resolve and
// check each path before removing it; never recursively delete a directory.
let previous = []
try {
  previous = JSON.parse(await readFile(indexPath, 'utf8')).files || []
} catch {}
const retained = new Set(files.map((file) => file.path))
for (const file of previous) {
  if (typeof file.path !== 'string' || retained.has(file.path)) continue
  const target = resolve(destination, file.path)
  const within = relative(destination, target)
  if (
    !within ||
    within === '..' ||
    within.startsWith(`..${sep}`) ||
    isAbsolute(within) ||
    resolve(target) === resolve(indexPath)
  )
    continue
  if (await exists(target)) await unlink(target)
}

await writeFile(
  indexPath,
  JSON.stringify({ source: '../training/CSPlatform/aim-trainer', files }, null, 2) + '\n',
)
console.log(`[training] Synced ${files.length} unmodified runtime files to public/vector-trainer.`)
