import { cp, access } from 'node:fs/promises'
import path from 'node:path'

function resourcesAppDir(context) {
  if (context.electronPlatformName === 'darwin') {
    const appName = context.packager.appInfo.productFilename
    return path.join(context.appOutDir, `${appName}.app`, 'Contents', 'Resources', 'app')
  }
  return path.join(context.appOutDir, 'resources', 'app')
}

/** electron-builder 会按 .gitignore 忽略 node_modules，这里在打包后强制拷入。 */
export default async function afterPack(context) {
  const projectDir = context.packager.projectDir
  const resourcesApp = resourcesAppDir(context)
  const srcModules = path.join(projectDir, 'desktop-staging', 'app', 'node_modules')
  const destModules = path.join(resourcesApp, 'node_modules')

  try {
    await access(srcModules)
  } catch {
    throw new Error(`缺少 ${srcModules}，请先运行 pnpm desktop:prepare`)
  }

  await cp(srcModules, destModules, { recursive: true, force: true })
  console.log(`afterPack: 已拷贝 node_modules → ${destModules}`)
}
