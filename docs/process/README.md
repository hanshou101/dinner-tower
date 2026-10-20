# docs/process：每票一个打卡文件

并行施工时多张票同改一张表必冲突，所以每张票把 AGENTS.md §4.2 的六步写进自己的 `Tn.md`（`T1.md`、`T2.md`……），`docs/03-PROCESS.md` 只放索引与稽核表。

每个 `Tn.md` 的格式：

```markdown
# Tn：<票标题>（AME-xxx）
## 1. 验收条件（从任务书逐字抄）
## 2. 测试先失败（命令 + 输出最后 20 行）
## 3. 实现（改了哪些文件）
## 4. 全量验证（命令 + 输出最后 20 行；含 bash scripts/verify.sh）
## 5. PR 与合并确认（PR 号 + gh pr view <号> --json state,mergedAt 的原始输出）
## 6. 偏差与建议
```
