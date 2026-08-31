# 部署到免费云平台（Render）指南

本项目已适配免费云平台 Render：通过后端读取环境变量获取管理员密码，避免仓库泄露；并带 `render.yaml` 一键部署配置。

## 步骤（全程免费，需用你的 GitHub 账号）

### 1. 上传代码到 GitHub
1. 注册 / 登录 GitHub（<https://github.com>）。
2. 右上角 `+` → `New repository`，仓库名如 `model-studio`，设为 **Public**，点 `Create repository`。
3. 在仓库主页点 **`Add file` → `Upload files`**，把 `deploy-studio.zip` 解压后的所有文件和文件夹拖进去（**不要**含 node_modules / data/visitors.json / data/messages / data/uploads / .cowork-temp），点 `Commit changes`。

> 若你会用 git，也可：`git init` → `git add .` → `git commit -m "deploy"` → `git remote add origin https://github.com/<你的用户名>/model-studio.git` → `git push -u origin main`（记得先按 .gitignore 排除敏感/运行时文件）。

### 2. 在 Render 创建服务
1. 打开 <https://render.com>，用 **GitHub** 登录（免费）。
2. 点 **`New` → `Blueprint`**（会读取仓库里的 `render.yaml` 自动配置）或 **`New` → `Web Service`** → `Connect a repository`，选择你的 `model-studio` 仓库。
3. 自动识别为 Node，构建命令 `npm install`，启动命令 `npm start`，计划选 **Free**。
4. **关键**：在服务的 **`Environment`** 标签页添加环境变量：
   - `ADMIN_PASSWORD` = 你希望的管理后台新密码（必填！）
   - `ADMIN_USERNAME` = admin（可选）
   - `LOCKED_ACCESS_CODE` = 模特解锁密码（可选，默认 VIP2026）
5. 点 **`Deploy`**，等构建完成。

### 3. 拿到正式地址
部署成功后，Render 会给你一个永久 HTTPS 地址，形如：
- 前台：`https://model-studio.onrender.com`
- 后台：`https://model-studio.onrender.com/admin.html`

以后每次推代码，Render 自动重新部署（autoDeploy）。

## 重要说明
- **免费版限制**：服务闲置约 15 分钟后自动休眠，首次访问需冷启动（约 30~60 秒）；文件存储为临时型，**重启/重新部署后会重置**会话与上传数据。适合演示/小规模使用。
- **数据持久化**：如需长期保存聊天记录、访客信息、上传图片，需要接数据库或持久盘（可后续加，我可以帮你迁移到云数据库）。
- **WebSocket 聊天**：Render 支持，实时客服可正常使用。
- **管理员密码**：必须用 `ADMIN_PASSWORD` 环境变量设置，否则为占位值 `change-me-on-deploy`，请务必改为强密码。
