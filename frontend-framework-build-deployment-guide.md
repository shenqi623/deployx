# 前端框架构建与部署方式速查

## 1. 前端框架与全栈框架概览

前端项目不应该只从“Vue / React / Astro”来区分，更重要的是判断项目最终属于哪一种构建模式：

- SPA / CSR：浏览器端渲染
- SSG：静态站点生成
- SSR：服务端渲染
- Hybrid：静态 + 服务端混合渲染
- Serverless / Edge：运行在云函数或边缘平台

常见技术如下：

| 技术 | 类型 | 常见用途 | SEO | SSR |
|---|---|---|---|---|
| Vue 3 | UI 框架 | 后台、Web App | 一般 | 需 Nuxt |
| React | UI Library | Web App、复杂应用 | 一般 | 需 Next 等 |
| Angular | 完整框架 | 企业后台、大型系统 | 一般 | 支持 |
| Svelte | UI 框架 | Web App | 一般 | 需 SvelteKit |
| Solid | UI 框架 | 高性能 Web App | 一般 | 需 SolidStart |
| Qwik | Web 框架 | 高性能网站 | 好 | 支持 |
| Astro | Web Framework | 官网、SEO、内容站 | 很好 | 支持 |
| Nuxt | Vue 全栈框架 | 官网、SEO、全栈 | 很好 | 支持 |
| Next.js | React 全栈框架 | 官网、SaaS、全栈 | 很好 | 支持 |
| SvelteKit | Svelte 全栈框架 | 网站、全栈 | 很好 | 支持 |

如果主要方向是网站开发、SEO、服务器部署，建议重点掌握：

```text
Vue3 + Vite
Nuxt
React + Vite
Next.js
Astro
```

---

# 2. 打包方式其实有两个概念

## 2.1 构建工具

常见构建工具：

```text
Vite
Webpack
Rspack
Rsbuild
Rollup
esbuild
Parcel
```

它们主要负责：

```text
源码
↓
编译
↓
Tree Shaking
↓
代码分割
↓
资源压缩
↓
文件 Hash
↓
HTML / CSS / JavaScript
```

---

## 2.2 构建输出模式

真正决定服务器如何部署的是构建输出模式。

| 模式 | 全称 | Node.js | SEO | 常见框架 |
|---|---|---:|---:|---|
| CSR | Client Side Rendering | 不需要 | 较弱 | Vue / React |
| SPA | Single Page Application | 不需要 | 较弱 | Vue / React |
| SSG | Static Site Generation | 不需要 | 很好 | Astro / Nuxt / Next |
| SSR | Server Side Rendering | 需要 | 很好 | Astro / Nuxt / Next |
| Hybrid | 混合渲染 | 通常需要 | 很好 | Astro / Nuxt / Next |

Serverless / Edge 可以理解为 SSR 的另一种运行环境，例如：

```text
Cloudflare Workers
Vercel Functions
AWS Lambda
Netlify Functions
```

---

# 3. Vue3 + Vite

## 3.1 源码目录

```text
vue-project/
├── src/
│   ├── main.ts
│   ├── App.vue
│   ├── components/
│   └── views/
├── public/
├── index.html
├── vite.config.ts
└── package.json
```

源码入口通常是：

```text
src/main.ts
```

例如：

```ts
import { createApp } from 'vue'
import App from './App.vue'

createApp(App).mount('#app')
```

## 3.2 打包

```bash
npm run build
```

通常生成：

```text
dist/
├── index.html
├── favicon.ico
└── assets/
    ├── index-Bx82Ksd.js
    ├── index-D72sd.css
    ├── vendor-Fhs82.js
    └── logo-Hs82.png
```

## 3.3 启动文件

Vue + Vite 静态项目没有 Node.js 启动文件。

不是：

```bash
node dist/index.js
```

而是：

```text
Nginx
↓
dist/index.html
↓
浏览器
↓
Vue JavaScript
```

## 3.4 部署方式

```text
Vue
↓
npm run build
↓
dist/
↓
Nginx
↓
用户
```

通常不需要：

```text
PM2
Node.js
npm start
```

---

# 4. React + Vite

## 4.1 源码目录

```text
react-project/
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   └── components/
├── public/
├── index.html
├── vite.config.ts
└── package.json
```

源码入口：

```text
src/main.tsx
```

## 4.2 打包

```bash
npm run build
```

输出：

```text
dist/
├── index.html
└── assets/
    ├── index-A71hd.js
    └── index-B23hs.css
```

## 4.3 部署

```text
Nginx
↓
dist/
```

React + Vite 和 Vue + Vite 在部署层面基本属于同一种类型。

---

# 5. Astro 静态模式

## 5.1 页面结构

```text
src/pages/
├── index.astro
├── about.astro
└── blog/
    └── index.astro
```

## 5.2 打包

```bash
npm run build
```

默认生成：

```text
dist/
├── index.html
├── about/
│   └── index.html
├── blog/
│   └── index.html
├── _astro/
│   ├── index.XXXX.js
│   └── index.XXXX.css
├── sitemap.xml
└── robots.txt
```

## 5.3 部署

```text
Astro Static
↓
npm run build
↓
dist/
↓
Nginx
```

不需要 PM2。

Astro SSG 的特点是每个页面可以直接生成 HTML：

```text
/about
↓
about/index.html
```

因此特别适合 SEO、官网和内容站。

---

# 6. Astro SSR 模式

如果使用 Node Adapter：

```js
import node from '@astrojs/node'

export default defineConfig({
  output: 'server',

  adapter: node({
    mode: 'standalone'
  })
})
```

## 6.1 打包产物

```text
dist/
├── client/
│   ├── _astro/
│   ├── favicon.ico
│   └── ...
└── server/
    ├── entry.mjs
    ├── chunks/
    ├── pages/
    └── ...
```

关键启动文件：

```text
dist/server/entry.mjs
```

## 6.2 Node 启动

```bash
node ./dist/server/entry.mjs
```

## 6.3 PM2 启动

```bash
pm2 start dist/server/entry.mjs --name astro-site
```

## 6.4 部署架构

```text
Internet
↓
Nginx
↓
127.0.0.1:4321
↓
PM2
↓
Node.js
↓
dist/server/entry.mjs
↓
Astro SSR
```

---

# 7. Nuxt

## 7.1 Nuxt SSR

执行：

```bash
npm run build
```

通常输出：

```text
.output/
├── public/
│   ├── _nuxt/
│   ├── favicon.ico
│   └── ...
└── server/
    ├── index.mjs
    ├── chunks/
    └── ...
```

关键启动文件：

```text
.output/server/index.mjs
```

Node 启动：

```bash
node .output/server/index.mjs
```

PM2：

```bash
pm2 start .output/server/index.mjs --name nuxt-site
```

部署架构：

```text
Nginx
↓
PM2
↓
Node.js
↓
.output/server/index.mjs
```

---

# 8. Nuxt 静态模式

执行：

```bash
npx nuxt generate
```

通常生成：

```text
.output/
└── public/
    ├── index.html
    ├── about/
    │   └── index.html
    ├── 200.html
    ├── 404.html
    └── _nuxt/
```

部署：

```text
.output/public/
↓
Nginx
```

不需要 PM2。

因此：

```text
Nuxt SSR
↓
.output/server/index.mjs
↓
PM2
↓
Nginx
```

而：

```text
Nuxt SSG
↓
.output/public/
↓
Nginx
```

---

# 9. Next.js

## 9.1 SSR / Node 模式

执行：

```bash
npm run build
```

生成：

```text
.next/
├── cache/
├── server/
├── static/
├── BUILD_ID
└── ...
```

标准生产启动方式：

```bash
npm run start
```

本质：

```bash
next start
```

PM2：

```bash
pm2 start npm --name next-site -- start
```

部署架构：

```text
Nginx
↓
PM2
↓
next start
↓
Next.js
```

---

# 10. Next.js 静态导出

配置：

```js
const nextConfig = {
  output: 'export'
}

export default nextConfig
```

执行：

```bash
npm run build
```

生成：

```text
out/
├── index.html
├── 404.html
├── about.html
├── blog/
└── _next/
```

部署：

```text
out/
↓
Nginx
```

不需要 Node 和 PM2。

---

# 11. Angular

Angular 常见构建：

```bash
ng build
```

纯前端模式可能生成：

```text
dist/
└── my-app/
    └── browser/
        ├── index.html
        ├── main-XXX.js
        ├── styles-XXX.css
        └── media/
```

部署：

```text
dist/my-app/browser/
↓
Nginx
```

如果使用 Angular SSR，则可能同时出现：

```text
browser/
server/
```

SSR 模式需要 Node.js 运行环境。

---

# 12. SvelteKit

SvelteKit 的构建方式取决于 Adapter。

常见 Adapter：

```text
@sveltejs/adapter-static
@sveltejs/adapter-node
adapter-cloudflare
adapter-vercel
adapter-netlify
```

## 静态模式

```text
adapter-static
↓
静态 HTML / CSS / JS
↓
Nginx / CDN
```

## Node 模式

```text
adapter-node
↓
Node Server
↓
PM2
↓
Nginx
```

所以看到 SvelteKit 项目时，应该先检查：

```text
svelte.config.js
```

判断用了什么 Adapter。

---

# 13. 如何快速判断一个陌生前端项目怎么部署

第一步先看：

```text
package.json
```

---

## 13.1 Vite

如果看到：

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  }
}
```

通常：

```text
vite build
↓
dist/
↓
Nginx
```

---

## 13.2 Astro

如果看到：

```json
"build": "astro build"
```

继续检查：

```text
astro.config.mjs
```

如果是：

```js
output: 'static'
```

部署：

```text
dist/
↓
Nginx
```

如果是：

```js
output: 'server'
```

部署：

```text
dist/server/entry.mjs
↓
Node.js
↓
PM2
↓
Nginx
```

---

## 13.3 Nuxt

如果：

```text
nuxt build
```

通常：

```text
.output/server/index.mjs
↓
PM2
↓
Nginx
```

如果：

```text
nuxt generate
```

通常：

```text
.output/public/
↓
Nginx
```

---

## 13.4 Next.js

如果：

```text
next build
next start
```

就是：

```text
.next/
↓
next start
↓
PM2
↓
Nginx
```

如果配置：

```text
output: export
```

就是：

```text
out/
↓
Nginx
```

---

# 14. 最常用部署速查表

| 技术 | 模式 | 构建目录 | 生产启动入口 | PM2 | Nginx |
|---|---|---|---|---|---|
| Vue3 + Vite | SPA | `dist/` | 无 | 不需要 | 静态 |
| React + Vite | SPA | `dist/` | 无 | 不需要 | 静态 |
| Angular CSR | SPA | `dist/.../browser` | 无 | 不需要 | 静态 |
| Astro Static | SSG | `dist/` | 无 | 不需要 | 静态 |
| Astro Node | SSR | `dist/` | `dist/server/entry.mjs` | 需要 | 反向代理 |
| Nuxt Static | SSG | `.output/public/` | 无 | 不需要 | 静态 |
| Nuxt Node | SSR | `.output/` | `.output/server/index.mjs` | 需要 | 反向代理 |
| Next Static | SSG | `out/` | 无 | 不需要 | 静态 |
| Next Node | SSR | `.next/` | `next start` | 需要 | 反向代理 |
| SvelteKit Static | SSG | Adapter 决定 | 无 | 不需要 | 静态 |
| SvelteKit Node | SSR | Adapter 决定 | Node Adapter | 需要 | 反向代理 |
| Qwik | SSG / SSR | Adapter 决定 | Adapter 决定 | 视情况 | 视情况 |

---

# 15. 最终可以归纳成两大部署模型

## 模型一：静态网站

适用于：

```text
Vue SPA
React SPA
Astro SSG
Nuxt SSG
Next Static
Angular CSR
```

部署流程：

```text
源码
↓
npm run build
↓
HTML + CSS + JavaScript
↓
Nginx
↓
用户
```

服务器通常只需要：

```text
Nginx
```

例如：

```text
/var/www/site/
├── index.html
└── assets/
```

---

# 16. 模型二：Node.js SSR 网站

适用于：

```text
Astro SSR
Nuxt SSR
Next SSR
SvelteKit SSR
```

部署流程：

```text
源码
↓
npm run build
↓
Node Server
↓
PM2
↓
Nginx
↓
用户
```

典型服务器架构：

```text
HTTPS :443
↓
Nginx
↓
proxy_pass
↓
127.0.0.1:3000
↓
PM2
↓
Node.js
↓
SSR Framework
```

---

# 17. 最重要的判断口诀

看到：

```text
index.html
assets/
```

优先判断为：

```text
静态项目
↓
Nginx 直接部署
```

看到：

```text
server/index.mjs
entry.mjs
next start
```

优先判断为：

```text
Node.js SSR
↓
PM2
↓
Nginx 反向代理
```

最终不要死记“Vue 怎么部署”“React 怎么部署”，而应该先判断：

```text
这个项目最终输出的是静态文件，
还是一个需要 Node.js 启动的服务？
```

只要判断清楚这一点，大多数前端服务器部署问题就可以快速解决。
