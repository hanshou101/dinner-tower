# scheduler — Dinner Tower 排程引擎

「一个烤箱、六道菜、全部 19:00 同时上桌」的核心算法。纯 TypeScript、零运行时依赖、完全确定性：同一输入永远产出逐字节相同的计划。MCP server（`server/`）直接 `import "../scheduler/src/index.ts"` 使用，不做进程间调用。

规格：`docs/01-SPEC.md` §6.2（数据模型 §6.2.1、核心算法 §6.2.2、冲突选项 §6.2.3、太晚了 §6.2.4、重排 §6.2.5、黄金值 §6.2.6）。本引擎按那份规格**逐字**实现——排序键 `(-prio, di, -si)`、逐分钟向下扫描、第一个可用烤箱、切换间隔判定，都不做「优化」。

## 跑测试

```bash
npm --prefix scheduler install     # 首次
npm --prefix scheduler test        # vitest run，39 条
npm --prefix scheduler run typecheck   # tsc --noEmit
```

从仓库根也能用 `bash scripts/verify.sh`，`scripts/verify.d/10-scheduler.sh` 会把上面两条接进去（CI 用 `bash scripts/verify.sh --ci`，缺依赖时先 `npm ci`）。

## API

时间一律是「当天分钟数」整数（0–1439，不跨午夜）。输入输出里的 `"HH:MM"` 只是对外格式，用 `parseTime` / `formatTime` 互转。

```ts
import {
  schedule, planOptions, findEarliestServe, replan, validatePlan,
  parseTime, formatTime, formatTime12h, formatDuration,
} from "../scheduler/src/index";
```

### `schedule(input): ScheduleResult`

§6.2.2 逆向贪心。依赖链从 `serveAt` 往回排，每一步尽量晚放。

```ts
const plan = schedule({
  dishes,                 // 菜品目录（Dish[]）
  dishIds: ["turkey", "stuffing", ...],  // 去重保序，目录里没有的忽略
  serveAt: parseTime("19:00"),
  kitchen: { ovens: 1, ovenRacks: 2, burners: 4, cooks: 2, ovenSwitchMinutes: 10 },
  altSteps: new Set(["stuffing.bake", "rolls.bake"]), // 共用烤箱时的替代做法
  fixed: new Map(),       // 已开始、原样占位的步骤（stepId → {start,end,oven,ovenTempF}）
  now: null,              // 下界：任何步骤不得早于它开始
  extra: new Map(),       // 未开始步骤追加分钟
});
```

返回 `{ feasible, serveAt, steps, readyAt, waits, violations }`：

- `steps` 按 `(start, stepId)` 排序，每项 `{ stepId, dishId, dishName, icon, label, minutes, uses, start, end, oven, ovenTempF, usedAlt }`；`oven` 是 **1 起算**的烤箱编号，不用烤箱时为 `null`。
- `readyAt` / `waits`：`dishId → 最后一步结束时间` / `dishId → serveAt − readyAt`。
- `violations`：`wait < 0 || wait > holdMinutes` 的菜，`{ dishId, dishName, readyAt, waitMinutes, holdMinutes }`。
- `feasible=false`：有步骤放不下，或有步骤被迫早于 `now` 开始。此时 `steps` 里仍是已经放下的部分，调用方不要当成可用计划。

### `planOptions(ctx): PlanOptions`

§6.2.3 的冲突与选项。

```ts
const options = planOptions({ dishes, dishIds, serveAt, kitchen, now: parseTime("13:00") });
options.primary      // 原始温度方案（无 alt）
options.conflict     // null（无违规）或 { message, options: [{id,label}], waits }
options.altSteps     // 值得提供 share-oven 时要切到 alt 的步骤 id
options.shareOven    // share-oven 方案；不提供时为 null
```

- `primary` 无违规 → `conflict === null`，`option` 取 `"primary"`。
- 有违规 → 迭代 `altSteps`（违规菜品中带 `alt` 的步骤），直到没有新增；若最终 alt 非空、可行、违规数严格少于 primary，`conflict.options` 是 `[share-oven, keep-temps]`，否则只有 `keep-temps`（此时不反问，`altSteps=[]`、`shareOven=null`，`conflict.waits` 如实列出等待）。
- 文案英文、时间 12 小时制，逐字照 §6.2.3 模板。

### `findEarliestServe({ dishes, dishIds, kitchen, from, now }): EarliestServe`

§6.2.4（太晚了）。`from` 是用户想要的上菜时间。返回：

```ts
{ ok: true, serveAt: 1310, noAlt: 1360, allAlt: 1310 }   // 21:50 / 22:40
{ ok: false, serveAt: null, noAlt: null, allAlt: null }  // 23:55 前都放不下
```

`serveAt` 取「无 alt」与「全部带 alt 的步骤都用 alt」两种情形里较早的一个；`ok=false` 时调用方用 §6.2.4 的 `… can't fit before midnight.`。

### `replan(ctx): ReplanResult`

§6.2.5 进行中重排。

```ts
const result = replan({
  dishes, dishIds, kitchen,
  plan,                       // 当前计划（schedule 的返回）
  serveAt: parseTime("19:00"),// 当前计划的 serveAt
  originalServeAt: parseTime("19:00"), // 首次请求值，不随重排移动（可选）
  now: parseTime("18:20"),
  target: "turkey",           // stepId 或 dishId
  minutes: 20,
  altSteps: ["stuffing.bake", "rolls.bake"], // 沿用原计划的 alt
});
result.serveAt; result.originalServeAt; result.schedule; result.targetStepId;
result.changes;  // [{ stepId, label, from: "15:30–18:30", to: "15:30–18:50" }]，按新 start 排序
```

- `target` 先当 stepId；否则当 dishId：优先「进行中」步骤（`start ≤ now < end`），没有就取最早未开始的步骤。
- 错误抛 `ReplanError`：`{label} is already done.`、`Nothing left to delay for {dish}.`、`Unknown target "…"`、`The kitchen can't fit that delay before midnight.`
- `changes` 只包含 start 或 end 变化的步骤；`revision+1` 由调用方（server）负责。

### `validatePlan(input): { ok, errors }`

AC-3 (a)–(d) 的独立复检：不复用 `schedule` 的任何内部函数，直接按步骤表重建占用。

- (a) 每分钟人手 ≤ `cooks`、炉头 ≤ `burners`、每个烤箱同时 ≤ `ovenRacks` 个步骤；
- (b) 每个烤箱同一分钟只有一个温度，不同温度之间有 ≥ `ovenSwitchMinutes` 的空档；
- (c) `after` 依赖成立（含 `gravy.make` 在 `turkey.roast` 之后这种跨菜品依赖）；
- (d) 每道菜的就绪时间落在 `[serveAt − holdMinutes, serveAt]`。

```ts
validatePlan({ dishes, dishIds, kitchen, serveAt, steps: plan.steps });
// → { ok: true, errors: [] } 或 { ok: false, errors: ["oven 1: 325°F and 350°F are both in the oven at 18:05 — one temperature at a time.", ...] }
```

### 时间工具

```ts
parseTime("19:00")      // 1140，非法格式/越界抛错
formatTime(1140)        // "19:00"
formatTime12h(1140)     // "7:00 PM"
formatDuration(220)     // "3 h 40 min"（45 → "45 min"，60 → "1 h"）
formatRange(910, 930)   // "15:10–15:30"
```

## 目录

```text
src/types.ts      §6.2.1 数据模型（Step/Dish/Kitchen/ScheduleInput/ScheduleResult）
src/time.ts       "HH:MM" ↔ 分钟、12 小时制、时长
src/schedule.ts   §6.2.2 逆向贪心核心
src/options.ts    §6.2.3 share-oven 迭代与选项文案；§6.2.4 earliest
src/replan.ts     §6.2.5 target 解析、fixed/extra、D 循环、changes
src/validate.ts   AC-3 (a)–(d) 独立复检
src/index.ts      统一导出
fixtures/thanksgiving.json   §6.2.1 前 6 道菜 + 黄金厨房（测试数据）
test/             vitest：表 A/B/C/D、选项文案、earliest、validatePlan、错误路径、确定性
```
