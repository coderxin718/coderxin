# 张严鑫 — 个人作品集

> AI 应用开发工程师 · 兼具 Java 后端工程与 AI 应用开发背景

🔗 **[在线访问](https://coderxin718.github.io/coderxin/)**

## 项目结构

```
my-portfolio/
├── index.html                          # 首页（Hero + 关于我）
├── README.md
├── .gitignore
├── apps-script.gs                      # Google Apps Script 表单后端
├── assets/
│   ├── css/
│   │   ├── base.css                    # Reset + CSS 变量 + 排版基础
│   │   ├── components.css              # 导航 · 按钮 · 卡片 · 表单 · 页脚
│   │   ├── pages.css                   # 页面布局（Hero/About/Projects/Contact）
│   │   └── responsive.css              # 响应式断点（1024 / 768 / 400）
│   ├── js/
│   │   ├── navbar.js                   # 动态导航组件（DRY — 6 页共享一份）
│   │   └── contact.js                  # 表单验证 & Google Apps Script 提交
│   └── images/
├── pages/
│   ├── projects.html                   # 项目列表
│   ├── contact.html                    # 联系
│   └── projects/
│       ├── cloud-agri.html             # 云农智能体 详情
│       ├── phenotype.html              # 植物表型智能分析平台 详情
│       └── infinite-chat.html          # 千言 InfiniteChat 详情
└── docs/                               # 项目文档（非 web 资源）
    ├── resume.md
    ├── project-cloud-agri.md
    ├── project-phenotype.md
    └── project-im.md
```

## 架构设计

### CSS 模块化

| 模块 | 职责 | 选择依据 |
|------|------|----------|
| `base.css` | CSS 自定义属性、Reset、排版基础 | 全局变量和基础层 |
| `components.css` | 可复用 UI 组件 | 组件级关注点分离 |
| `pages.css` | 各页面布局 | 页面级布局隔离 |
| `responsive.css` | 全部媒体查询 | 集中管理响应式断点 |

### 导航 DRY 策略

导航栏 HTML 不在每个页面中重复 — 引入 `navbar.js` 动态渲染：

```html
<!-- 每个页面只需一个占位标签 -->
<nav id="navbar" data-active="home"></nav>
<script src="assets/js/navbar.js"></script>
```

`navbar.js` 根据 `data-active` 属性自动设置当前页高亮，并依据路径深度计算正确的相对资源路径（`./` / `../` / `../../`）。

**优点**：修改导航只需改一个 JS 文件，避免 6 个 HTML 文件的同步维护负担。无需引入 npm 构建工具链，保持零依赖。

### 页面路由

所有非首页 HTML 移入 `pages/` 目录，项目详情页位于 `pages/projects/` 子目录，形成与 URL 结构一致的物理层级。

## 技术栈

- **前端**: 纯静态 HTML5 + CSS3 + Vanilla JS（零框架依赖）
- **部署**: GitHub Pages (`coderxin718.github.io/coderxin/`)
- **表单**: Google Apps Script 无服务器后端

## 本地开发

直接用浏览器打开 `index.html` 即可预览。

## License

MIT
