# GitHub文件管理器

<div align="center">

一款基于 Cloudflare Worker 的 GitHub 文件管理工具，支持多用户独立配置管理。

![CF](https://img.shields.io/badge/Cloudflare-Workers-orange?style=flat-square)
![GitHub Repo size](https://img.shields.io/github/repo-size/belugaQAQ/github-flie-manager?style=flat-square)

</div>

## 功能

### 文件管理

- [x] 查看 GitHub 仓库指定文件夹的文件列表
- [x] 多文件上传（支持批量上传和进度显示）
- [x] 文件预览（图片、文档等直接在浏览器中查看）
- [x] 文件下载
- [x] 文件删除
- [x] 文件编辑（文本文件在线编辑）

### 用户系统

- [x] 用户注册与登录
- [x] 个人配置管理（每个用户独立的 GitHub Token 和仓库配置）
- [x] GitHub Token 验证（显示用户头像和信息）
- [x] 安全的会话管理

### 界面特性

- [x] 动态路径管理（支持任意数量 GitHub 文件夹）
- [x] Material Design 3 现代化界面
- [x] 深色模式支持
- [x] 动态主题色系统
- [x] 响应式设计，支持移动设备

## 安装

### 环境要求

- Node.js >= 16.0.0
- Cloudflare 账户

### 配置 KV

**1. 创建 KV 命名空间**

```bash
wrangler kv namespace create GHFM_KV
wrangler kv namespace create GHFM_KV --preview
```

**2. 配置 wrangler.toml**

```toml
name = "github-file-manager"
main = "index.js"
compatibility_date = "2025-07-18"

[[kv_namespaces]]
binding = "KV"
id = "你的KV命名空间ID"
preview_id = "你的预览环境KV_ID"
```

### 安装依赖

```bash
npm install
```

### 本地开发

```bash
npm run dev
```

### 部署

```bash
npm run deploy
```

## 使用说明

### 首次使用

1. 访问 `/register` 页面创建账户
2. 使用注册的用户名和密码登录
3. 首次登录会自动跳转到设置页面
4. 填写 GitHub Token、Owner、Repo、Branch 和路径配置
5. 点击"验证 Token"按钮检查 Token 有效性
6. 保存配置

### 设置页面 (`/settings`)

| 配置项 | 说明 |
|--------|------|
| GITHUB_TOKEN | GitHub 个人访问令牌 |
| GITHUB_OWNER | 仓库所有者用户名 |
| GITHUB_REPO | 仓库名称 |
| GITHUB_BRANCH | 分支名称（默认 main） |
| 路径配置 | 动态添加/删除多个文件夹路径 |

### 文件操作

#### 上传
- 支持单文件和多文件上传
- 实时显示上传进度
- 支持文件筛选和删除

#### 预览
- 支持格式：JPG、PNG、GIF、BMP、WebP、SVG、PDF、TXT、MD、HTML、XML、JSON、CSV、LOG

#### 编辑
- 支持文本文件在线编辑
- 保存后直接提交到 GitHub

## 安全特性

### 认证安全
- 密码使用 SHA-256 + Salt 哈希存储
- 会话使用 KV 持久化，支持多实例共享
- HttpOnly Cookie 防止 XSS 窃取
- 会话 1 小时自动过期

### 速率限制
- 登录/注册：15分钟内最多5次尝试
- 基于 Cloudflare 真实 IP 识别

### 数据安全
- GitHub Token 使用 AES-GCM 加密存储
- 每个用户只能访问自己的配置数据
- 所有动态内容进行 HTML 转义

## KV 数据模型

| 键格式 | 说明 |
|--------|------|
| `user:{username}` | 用户账户（密码哈希、创建时间） |
| `session:{token}` | 会话数据（TTL=1h） |
| `config:{username}` | 用户配置（AES-GCM 加密） |
| `login:{ip}` | 登录速率限制 |

## GitHub Token 权限

确保您的 GitHub Token 具有以下权限：
- `repo` (完全控制私有仓库)
- 或 `public_repo` (仅公开仓库)

## 故障排除

### 401 错误
- 检查 GitHub Token 是否有效
- 使用"验证 Token"功能测试
- 确认仓库、分支、路径是否存在

### 登录问题
- 检查用户名和密码是否正确
- 清除浏览器 Cookie 后重试
- 检查 KV 是否正常工作

### KV 数据不持久
- 本地开发确保使用 `--local --persist` 标志
- 重启开发服务器后检查数据是否保留

## 技术栈

- **Cloudflare Workers** - 无服务器计算平台
- **Cloudflare KV** - 键值存储数据库
- **GitHub REST API** - 文件操作接口
- **Material Design 3** - 现代化 UI 设计语言

## 许可证

MIT License
