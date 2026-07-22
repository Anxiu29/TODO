# 桌面代办（Desktop Todo Widget）

一个轻量的 **Windows 桌面待办挂件**：贴在桌面上、全局快捷键快速添加、跨日自动滚动进行中任务，并支持应用内更新。

当前版本：`0.2.2`

## 功能

- **桌面挂件**：今日待办列表，完成 / 删除 / 内联编辑标题
- **紧急评分**：1–5 星，影响列表排序
- **右键查看**：添加时间与已过去天数
- **快捷添加**：全局快捷键唤起小窗，Enter 即可添加
- **日切滚动**：跨天后，进行中的待办自动归属到今天
- **完成日历**：按月回看每日完成情况，支持恢复为进行中
- **显示模式**：普通窗口，或尝试固定到 Windows 桌面层（Win+D 后仍可能可见）
- **始终置顶**：可选悬浮在任意页面之上
- **系统托盘**：点击显示挂件，右键退出
- **开机自启**、快捷键自定义
- **应用内更新**：检查到新版本后展示更新日志，由你决定是否下载安装

## 截图

> 可在此补充挂件、快捷添加、日历、设置等截图。

## 安装与使用

提供两种分发形态（见 [Releases](https://github.com/Anxiu29/TODO/releases)）：

| 类型 | 文件名示例 | 说明 |
|------|------------|------|
| 安装版 | `Desktop-Todo-Widget-Setup-x.y.z.exe` | NSIS 安装包，可改安装目录 |
| 便携版 | `Desktop-Todo-Widget-x.y.z.exe` | 单文件，数据写在 exe 旁 `data/` |

### 默认快捷键

| 操作 | 默认快捷键 |
|------|------------|
| 快捷添加 | `Ctrl + 2` |
| 显示组件 | `Ctrl + 1` |

可在设置页点击输入框后按下新组合键进行录制。

### 数据存放位置

| 环境 | 路径 |
|------|------|
| 开发 / 安装版 | `%APPDATA%\Desktop Todo Widget\todos.json` |
| 便携版 | `{exe 同目录}\data\todos.json` |

安装版数据放在 AppData，避免升级安装目录时丢失待办。

## 开发

### 环境要求

- Node.js（建议 LTS）
- Windows（贴桌面、开机自启、便携更新等能力面向 Windows）

### 常用命令

```bash
npm install
npm run dev          # 开发模式
npm test             # 单元测试
npm run build        # 类型检查 + 构建到 out/
npm run dist         # 打包安装版 + 便携版到 release/<version>/
```

### 发布到 GitHub Release

1. 复制 `.env.example` 为 `.env`，填入 `GH_TOKEN`
2. 编辑根目录 `RELEASE_NOTES.md`（会作为 Release 更新日志展示给用户）
3. 安装并登录 [GitHub CLI](https://cli.github.com/)
4. 执行：

```bash
npm run dist:publish
```

## 技术栈

- **Electron** + **electron-vite** + **TypeScript**
- **React** 渲染四类窗口（`?view=widget|add|calendar|settings`）
- **electron-updater**：GitHub Release 更新（安装版 / 便携版分 channel）
- **koffi**：调用 Win32 API，实现桌面层附着
- **Vitest**：纯业务逻辑测试（排序、日切、日历聚合等）

## 目录结构

```
electron/           # 主进程：窗口、IPC、托盘、更新、贴桌面
  desktop/          # WorkerW 桌面附着
src/                # 渲染进程 UI
  data/             # 可单测的纯业务逻辑
  types/            # 类型定义
scripts/            # 发布、生成 yml、桌面附着诊断
tests/              # Vitest
build/              # 应用图标等资源
RELEASE_NOTES.md    # 发版更新日志（给用户看）
```

## 架构要点

- 主进程是唯一写盘层；渲染进程通过 `window.todoApi`（preload + contextBridge）访问
- 业务规则集中在 `src/data/todoStore.ts`，便于测试
- 单实例运行；关掉所有窗口也不会退出，以便全局快捷键继续工作
- 更新默认不自动下载：先展示 `RELEASE_NOTES.md` / Release 正文，用户确认后再下载

## 许可证

当前仓库未附带 LICENSE 文件；若需开源分发，请自行补充合适的许可证。
