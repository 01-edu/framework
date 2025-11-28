/**
 * @module
 * Builds npm distributions for each package directory using @deno/dnt.
 * Scans subdirectories that contain both deno.json and package.json, uses
 * exports as entry points and compilerOptions from deno.json, and outputs to
 * .npm. After build, promotes `npm:` imports to peerDependencies and copies
 * LICENSE/README into the package output.
 */

import { build, type BuildOptions, emptyDir } from '@deno/dnt'
const root = import.meta.dirname!
const outDir = '.npm'
for await (const dir of Deno.readDir(root)) {
  if (!dir.isDirectory) continue
  const base = `${root}/${dir.name}`
  Deno.chdir(base)
  const extraPkgFile = `${base}/package.json`
  try {
    await Deno.stat(extraPkgFile)
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) continue
    throw err
  }
  const configFile = `${base}/deno.json`
  try {
    await Deno.stat(configFile)
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) continue
    throw err
  }
  const extraPkg = JSON.parse(Deno.readTextFileSync(extraPkgFile))
  const cfg = JSON.parse(Deno.readTextFileSync(configFile))

  // 2. Clean the output directory
  await emptyDir(outDir)
  await build({
    entryPoints: Object.entries(cfg.exports as Record<string, string>).map((
      [name, path],
    ) => ({ kind: 'export', name, path })),
    outDir,
    shims: { deno: false },
    compilerOptions: cfg.compilerOptions as BuildOptions['compilerOptions'],
    scriptModule: false,
    package: {
      name: cfg.name! || '',
      version: cfg.version! || '',
      description: `generated npm version of jsr:${cfg.name}`,
      license: cfg.license,
      sideEffects: false,
      publishConfig: {
        access: 'public',
        provenance: true,
        registry: 'https://registry.npmjs.org/',
      },
      repository: {
        type: 'git',
        url: 'git+https://github.com/01-edu/framework.git',
      },
      bugs: {
        url: 'https://github.com/01-edu/framework/issues',
      },
      ...extraPkg,
    },
  })
  const npmDeps = Object.values(
    (cfg.imports || {}) as Record<string, string>,
  )
    .filter((i) => i.startsWith('npm:'))
  const pkgFile = `${outDir}/package.json`
  const pkg = JSON.parse(Deno.readTextFileSync(pkgFile))
  pkg.peerDependencies || (pkg.peerDependencies = {})
  for (const dep of npmDeps) {
    const key = dep.slice('npm:'.length, dep.lastIndexOf('@'))
    pkg.peerDependencies[key] = pkg.dependencies[key]
    pkg.dependencies[key] = undefined
  }
  Deno.writeTextFileSync(pkgFile, JSON.stringify(pkg, null, 2))
  Deno.copyFileSync(`${root}/LICENSE`, `${outDir}/LICENSE`)
  Deno.copyFileSync(`${base}/README.md`, `${outDir}/README.md`)
  const publish = new Deno.Command('npm', {
    args: ['publish', '--verbose'],
    cwd: outDir,
  })
  const result = await publish.spawn().output()
  if (result.code === 0) continue
  console.log('failed to publish package')
  Deno.exit(1)
}
