# DeployX · 本机部署工作台

在本地运行的部署控制台：识别 Vue / React / Astro / Nuxt / Next 项目，经 SSH 部署到 Linux 服务器（Nginx；Node 模式使用 PM2，HTTPS 使用 Certbot）。

项目构建与认证信息只在本机处理；发往服务器的是部署产物。

## 环境要求

- Node.js：`^22.18.0` 或 `>=24.12.0`
- 包管理器：建议 [pnpm](https://pnpm.io/)
- 目标服务器：Linux，当前用户免密 `sudo`
  - 需具备：Nginx；Node 模式另需 Node 22+、PM2；HTTPS 另需 Certbot（含 nginx 插件）
  - **Ubuntu / Debian** 空白机可在「连接服务器」步骤一键安装缺失依赖（不会静默安装，需手动确认）
  - 其他发行版请自行安装上述组件
  - 域名已解析到服务器，80 / 443 可访问

## 桌面软件（Windows 推荐）

面向不熟悉命令行的用户，可打包成 **安装包** 与 **绿色版**（内置 Node，无需本机安装 Node）。

### Windows / macOS（推荐：GitHub Actions）

打开仓库 → **Actions** → **Build Desktop** → **Run workflow**。

跑完后在 **Summary → Artifacts** 下载：

| 文件 | 给谁用 |
|------|--------|
| `DeployX-windows-x64` | Windows（Setup / Portable） |
| `DeployX-mac-arm64` | Apple Silicon（M1/M2/M3） |
| `DeployX-mac-x64` | Intel Mac |

本机也可分别打包：

```sh
pnpm desktop:dist:win   # Windows
pnpm desktop:dist:mac   # 仅在 Mac 上
```

本地先看窗口效果（需本机已有 Node）：

```sh
pnpm desktop
```

开发调试仍可用 `pnpm dev`（浏览器）。

## 安装与启动（命令行方式）

```sh
pnpm install
```

### 开发（前端 + 本地 API）

```sh
pnpm dev
```

- 界面：http://127.0.0.1:5173
- API：http://127.0.0.1:4318（Vite 将 `/api` 代理到此端口）

### 生产（构建后由本机服务托管界面）

```sh
pnpm build
pnpm start
```

打开：http://127.0.0.1:4318

侧栏显示「本地服务已连接」后再开始配置。

## 部署向导（6 步）

1. **选择项目**  
   填写含 `package.json` 的绝对路径并「识别项目」。会自动判断 Vue / React / Astro / Nuxt / Next，以及**静态 Nginx** 或 **Node + PM2**。  
   - Astro：读取 `astro.config`，`server/hybrid` → Node，否则静态  
   - Nuxt：`generate` / `ssr:false` → 静态 `.output/public`；否则 SSR → `.output/server/index.mjs` + PM2  
   - Next：`output: "export"` → 静态 `out/`；否则 SSR → `next start` + PM2（自动安装 production 依赖）  
   多仓库请定位到实际前端子项目。

2. **连接服务器**  
   填写主机、端口、用户与认证方式（私钥 / 密码）→ 获取并核对指纹 → 测试连接。  
   连接后会展示依赖检测清单；若缺 Nginx / Node / PM2 / Certbot，可在 Ubuntu/Debian 上一键安装，装完自动复检。  
   认证信息只保留在后台会话中，不会写入草稿。

3. **站点清单**  
   手动添加，或导入 CSV。可按「序号」列批量勾选。  
   Astro / CMS 多站通常需要每个域名的 `SITE_KEY`。

4. **部署设置**  
   - 静态：Nginx 直接托管（Vue / React 可开 SPA 回退）  
   - Node：PM2 + Nginx 反向代理（需入口文件与起始端口）  
   - 可选 HTTPS、部署后验证、失败后继续

5. **确认执行**  
   「生成执行计划」只做检查，不构建、不改服务器。确认范围后勾选同意，再开始部署。

6. **任务中心**  
   查看进度与日志；可停止（当前站完成后）、重试失败站点、导出结果 CSV / 日志。

每个域名独立目录，新版本写入 `releases`，`current` 指向当前版本。非本工具管理的目录不会被覆盖。

## 常用命令

| 命令 | 说明 |
|------|------|
| `pnpm dev` | 开发：API 热重载 + Vite |
| `pnpm build` | 类型检查 + 前端构建 |
| `pnpm start` | 仅启动本机 API（并托管 `dist`） |
| `pnpm desktop` | 构建前端并用 Electron 打开桌面窗口 |
| `pnpm desktop:dist` | 打包 Windows 安装包 + 绿色版到 `release/` |
| `pnpm test` | 运行 `server/*.test.mjs` |
| `pnpm type-check` | 仅 TypeScript / Vue 类型检查 |
| `pnpm format` | Prettier 格式化 `src/` |

## 数据与安全

- 任务历史等保存在项目目录 `.deployx/`（已 gitignore）
- 浏览器「保存草稿」不含环境变量值与认证信息
- 私钥、密码、服务账号 JSON 仅用于当前连接会话
- API 仅监听 `127.0.0.1`，并校验 Host / Origin / 本机客户端头

## CSV 模板字段

支持表头：`序号` / `domain`（或 `域名`）、`siteKey`、`Port`（或 `端口`）。界面中可下载模板。

## 项目结构（简要）

```
src/          部署向导 UI（Vue 3）
server/       本机 API：识别项目、SSH、依赖安装、构建上传、任务
scripts/      开发启动脚本
.deployx/     本地运行数据（勿提交）
electron/     桌面壳（Electron）
release/      桌面安装包输出
```
