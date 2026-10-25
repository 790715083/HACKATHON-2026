<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Pull Request 工作流

- 所有代码、配置和文档变更都必须通过 Pull Request（PR）交付。每项独立任务使用单独的工作分支和 PR，不直接在 `main` 上提交或推送。
- 开始新任务时先检查 Git 状态并更新远端引用，从最新的 `origin/main` 创建 `codex/<task-name>` 分支。如果当前工作区有其他任务的未提交改动，使用独立 worktree，保留已有改动。
- 只暂存、提交本次任务相关文件。同一任务的后续修改继续提交到原分支并更新尚未合并的 PR；原 PR 合并后，再有变更需创建新分支和新 PR。
- 提交前检查 diff，并按变更影响完成验证。应用代码变更运行适用的 `pnpm typecheck`、`pnpm test`、`pnpm build`；界面交互变更补充实际操作验证。纯文档变更检查内容和 `git diff --check` 即可。未运行或未通过的检查需在 PR 中如实说明。
- 完成后提交并推送工作分支，创建以 `main` 为目标的 PR。PR 标题和描述应说明解决的问题、最终行为、验证结果及必要的限制；完成任务时向用户返回 PR 链接。
- 仅在用户明确要求合并时执行 PR 合并。不得为绕过 PR 流程而直接推送 `main`。
