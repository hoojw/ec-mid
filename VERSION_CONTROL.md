# 电商中台版本管理

2026-11-27 以当前云端部署建立独立 Git 基线，分支 main。
本地工作副本保存同一提交；旧本地仓库及处方项目未合并、未改动。

## 使用

- 查看修改：`git status`、`git diff`。
- 提交经检查的代码：`git add <文件>`，然后 `git commit -m "说明"`。
- 本仓库采用源码白名单；新增源码须同时将路径加入 `.gitignore` 的例外列表。
- `git show baseline-20261127:<文件>` 可查看本次基线，不要在运行目录执行全目录 reset 或 clean。
- 团队公开仓库：`https://github.com/hoojw/ec-mid.git`。本地 `origin` 指向 GitHub，`production` 保留云端工作目录地址。
- 修改部署配置时先核对线上服务。`deploy/systemd` 是单元文件快照，不会自动安装或启用。

## 不纳入版本库

实际账号密码、密钥、env/config、浏览器登录态、运行状态、数据库数据、上传文件、日志、
venv/node_modules、备份与候选目录均保留原位置并忽略。历史 AGENTS.md 含旧凭据，不纳入本次仓库。
不得修改原有处方目录、数据、浏览器、服务或定时器。

## 当前入口

- `server.js`，由 `ec-mid.service` 启动。
- Node 依赖由 `package-lock.json` 锁定；成本表解析与导出使用 Python/openpyxl。
- 环境变量使用 `/etc/ec-mid/ec-mid.env`，不入库。
- 成本、费率、活动计算、售后和交易分析源码均纳入。

## 团队协作

```sh
git switch main
git pull --ff-only origin main
git switch -c feat/your-task
# 修改代码、验证后提交指定文件
git add <files>
git commit -m "说明本次修改"
git push -u origin HEAD
```

在 GitHub 发起 PR，审核后合并到 main；仓库公开不代表他人有写入权限，成员需要仓库协作者权限，或从 fork 发起 PR。
代码推送不自动部署生产，发布须另行执行并记录提交号。GitHub 分支保护、协作者名单尚未配置。
