# 00-BRIEF：比赛规则拆解

> 角色：主控代寫（賽道單 AME-838：時間極緊，不另開偵察票）。只寫事實與出處，不寫「打不打」。原文用引號，換算的時間注明「北京時間」。
> 核實日期：2026-10-20（北京時間）。官方規則頁 `/rules` 有 Cloudflare 驗證，`r.jina.ai` 與無頭瀏覽器都被擋，用本機有頭 Chrome 讀到全文。

## 1. 基本信息

| 項 | 內容 | 出處（URL） |
| --- | --- | --- |
| 比賽名稱 | Build, Ship, Shape: Amazon Developer Hackathon | https://amazonappdev2026.devpost.com/ |
| 主辦 / 賽道 | Sponsor：Amazon Developer；Administrator：Devpost。主賽道 Fire TV / **Alexa+** / Bee / Ring，另有兩個 mini challenge：AWS Builder、Open Source | https://amazonappdev2026.devpost.com/rules §2、§4 |
| 官方頁 / 規則頁 | 首頁、`/rules`、`/details/faqs`、`/resources`、`/updates`、`/details/dates` | 同上 |
| 報名截止（北京時間） | 無單獨報名截止；提交期內點「Join hackathon」即可，提交期結束即關 | `/rules` §4 "How To Enter" |
| 提交截止（北京時間） | "Friday, October 23, 2026 (12:00 pm Pacific Time)" = **2026-10-24 03:00**（Schedule 頁："October 23 at 7:00PM UTC"） | `/rules` §1；`/details/dates` |
| 評審 / 公布 | 評審 "November 9, 2026 – November 20, 2026"；公布 "On or around Thursday, December 3, 2026" | `/rules` §1 |
| 奖项（本赛道） | Alexa+ 第一 $25,000 cash + $15,000 AWS Credits + 與 Amazon Developer 團隊會面；第二 $15,000 + $5,000 Credits；第三 $4,000 + $1,000 Credits。Mini challenge（AWS Builder、Open Source）各 $5,000 cash + $5,000 Credits。"A project can only win one (1) track prize and one (1) mini challenge prize." | `/rules` §8 |
| 資格原文（中國大陸、個人） | "Individuals who are at least the age of majority where they reside as of the time of entry"；排除 "Brazil, Quebec, Russia, Crimea, Cuba, Iran, and North Korea and any other country which is comprehensively sanctioned by the U.S. Treasury's Office of Foreign Assets Control" → **中國大陸未被排除；個人可參賽**（FAQ 同口徑） | `/rules` §3；`/details/faqs` |
| 參賽規模 | 首頁 Participants 計數 57,232（2026-10-20 讀取） | 首頁導航欄 |

## 2. 提交物清單（逐項；包裝票按這張表打勾）

| # | 提交物 | 規則原文 | 格式 / 上限 / 語言 |
| --- | --- | --- | --- |
| 1 | 文字說明 | "Include a text description that should explain the features and functionality of your Project." | 英文 |
| 2 | GitHub 倉庫 URL | "Provide a URL to your code repository for judging and testing on GitHub. The repository must contain all necessary source code, assets, and instructions required for the project to be functional." "must be either public and open source by including an open source license file OR private and shared with testing@devpost.com and the Amazon team" | 只收 GitHub（FAQ：GitLab 不行）。公開倉庫："this license should be detectable and visible at the top of the repository page (in the About section)"。私有倉庫須加協作者 knmeiss、giolaq、anishamalde、mosesroth、emersonsklar（Update 另列 chris-trag）+ testing@devpost.com，邀請 7 天過期 |
| 3 | Alexa+ 技術硬鉤 | "A working Agent Skill or a self-hosted MCP server, implementing MCP spec version 2025-11-25 (or a later version, once confirmed) over Streamable HTTP." 且 "The repository must demonstrate use of your track's required technology at runtime in your code — imported and actually called … not just named in the README." | 代碼裡真實 import 並調用 MCP SDK、真實跑 Streamable HTTP |
| 4 | 演示視頻 | "should be less than three (3) minutes"；"must be uploaded to and made publicly visible on YouTube or Vimeo"；"must not include third party trademarks, or copyrighted music or other material unless the Entrant has permission" | **< 3:00**、YouTube 或 Vimeo 公開、英文（Language Requirements）。Update：「Don't leave your video upload to the last minute」 |
| 5 | 產品反饋（每個工具） | "Include Product Feedback for each tool, API, or SDK used in your project"：用了什麼做什麼 / 什麼好用 / 什麼要改 / onboarding（zero to hello world）/ 會不會再用及原因 | 英文，必填 |
| 6 | 賽道與 mini challenge 選擇 | "Identify which Primary Track(s) …" "Identify which Mini Challenge(s) …" | 表單欄位 |
| 7 | Open Source mini challenge 附加欄位（若參加） | "Provide contribution URL, project repository URL, GitHub username, and a description of what you did, how it works, and why it matters." | 須是 "a new, additional open-source project or … contribution" |
| 8 | 既有項目說明（若適用） | "If your project existed before the hackathon, a clear explanation of what you built or changed during the submission window." | 本作品全新，不適用 |
| 9 | 選填：Feature requests | "description, why it matters to their project, and priority rating (Critical / Important / Nice-to-have)" | 選填 |
| 10 | 選填：Friction log | "specific task attempted, steps taken, expected vs. actual result, severity rating, workaround used, and actionable suggestion. Participants who submit friction logs score higher in judging (up to 10% bonus)." | **選填但加分最高 10%** |

## 3. 評審標準

兩階段："Stage One … pass/fail whether the ideas meet a baseline level of viability, in that the Project reasonably fits the theme and reasonably applies the required APIs/SDKs"；Stage Two 四項**等權**，每項 1–5 分（Update "Got an idea?"："scored 1 to 5 on four equally weighted criteria"）。

| 維度 | 權重 | 規則原文 |
| --- | --- | --- |
| Tech Implementation | 25% | "How well is the project built, and how effectively does it use the required tech? Does it effectively leverage the required APIs, SDKs, or device capabilities for the specified track …?" |
| Design | 25% | "Does the project deliver a complete, coherent product experience? Is the interaction model intuitive and well-considered for the target device or platform?" |
| Potential Impact | 25% | "Does the project make a credible, specific case for solving customer needs? Could it realistically serve an audience beyond the hackathon?" |
| Quality of the Idea | 25% | "Is this a creative, imaginative use of the required tools? Does the team demonstrate a genuine understanding of the developer ecosystem and the end-user needs within their chosen track?" |
| Alexa+ 平庸 vs 創意（規則原文） | — | "Obvious: single-turn Q&A bot, basic MCP wrapper around an existing API. Creative: agentic workflow that orchestrates across services autonomously, context-aware add-on that maintains state across sessions, purchasing capabilities, media support (cards, carousels, etc), MCP Apps, Agent Skills." |
| 加分 | 最高 +10% | "Amazon's internal review team assesses each submission's friction log entries (if provided) and passes a recommended bonus — up to 10% — to the Stage 2 judging panel" |
| 同分 | — | 依上列標準順序逐項比（Tech Implementation 先比） |

評審可能只看材料不跑代碼："Judges are not required to test the Project and may choose to judge based solely on the text description, images, and video provided in the Submission." → **視頻與文字說明的權重實際上很高。**

## 4. 技術硬約束（必須用的平台、API、模型、部署位置）

- Alexa+ 賽道：自託管 MCP server，MCP spec **2025-11-25** 以上，**Streamable HTTP** 傳輸；或 Agent Skill；或模擬 Alexa+ 體驗的網頁（模擬路徑豁免 runtime 硬鉤，但要交模擬器源碼）。
- 不需要硬件、不需要部署：FAQ "A locally runnable public repo plus your demo video is enough"；"Your MCP server doesn't need to stay running after you submit."
- 演示方式：FAQ "A web page that acts as an actual MCP client (sending initialize, tools-list, and tools-call requests over Streamable HTTP) satisfies the requirement … Showing an existing AI assistant app calling the same server is a nice bonus, but not required."
- 官方 Alexa+ 開發工具（Category SDK、MCP Toolkit、CLI、Web Simulator）**拿不到**：FAQ "available to select partners only - there is currently no way for hackathon participants to apply for or gain access"。
- 官方 Resources 頁 Alexa+ 一節只給兩個鏈接：MCP Apps 的 "Build with Agent Skills"（https://apps.extensions.modelcontextprotocol.io/api/#build-with-agent-skills）與 Streamable HTTP 規範（https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#streamable-http）。
- 2026-10-20 實測的生態事實：`@modelcontextprotocol/sdk@1.32.1` 與 v2 拆分包 `@modelcontextprotocol/server|client@2.3.1` 的 `LATEST_PROTOCOL_VERSION` 都是 `'2025-11-25'`；MCP Apps 擴展 `@modelcontextprotocol/ext-apps@2.0.3` 依賴 v2 拆分包與 zod ^4.2，自帶伺服器端（`registerAppTool`/`registerAppResource`）、iframe 端（`App`）、宿主端（`AppBridge`）；官方範例 `examples/basic-host`、`examples/basic-server-vanillajs`（Apache-2.0 / MIT）。MCP Apps 已被 Claude、ChatGPT、VS Code、Goose 支援（ext-apps API 文檔 "Supported Clients"）。
- AWS 額度已發完："October 7th Update: We are out of credit codes and will no longer be accepting credit requests."

## 5. 知識產權與開源要求

- "All Submissions remain the intellectual property of the individuals or organizations that developed them." 主辦方得到評審用的非獨占許可，並可在三年內宣傳使用作品與參賽者姓名肖像。
- 作品須原創、獨有："be solely owned by you … not violate the intellectual property rights"。可以用開源軟件，但須遵守許可證，且要 "creates software that enhances and builds upon the features and functionality included in the underlying open source product"。
- 第三方 SDK / API / 數據須有授權："Entrant must be authorized to use them in accordance with any terms and conditions"。
- 公開倉庫須帶開源許可證文件（本倉庫已有 MIT `LICENSE`）。
- 截止後鎖定：Update "Final stretch"："Please do not edit your code repo, video, or any project materials from the deadline until after the winner announcement, even minor changes could affect your eligibility." → **北京時間 10-24 03:00 至 12-04 期間，本倉庫 main 與視頻不得改動。**

## 6. 往屆 / 本屆已公開作品

本屆是首屆（首頁："For the first time, Fire TV, Alexa+, Ring, and Bee are all part of one global hackathon"），作品庫 2026-10-20 尚未公開（"The hackathon managers haven't published this gallery yet"）。下列取自 Amazon 往屆 Alexa 多模態挑戰（2019-04 公布，Amazon Alexa Blog 原文）與搜尋摘要：

| 作品 | 一句話 | 鏈接 | 評委為什麼喜歡它 |
| --- | --- | --- | --- |
| Loop It!（Grand Prize $20,000） | 用語音或觸控挑鼓、貝斯、旋律 loop 拼出音樂 | https://devpost.com/software/loop-it | 原文："focused heavily on a voice first experience, and APL allowed me to add the icing onto the cake"：語音優先 + 螢幕加分 |
| Fork On the Road（Best Multimodal Kitchen） | 廚房場景的決策小工具 | https://devpost.com/software/fork-on-the-road | 廚房是 Echo Show 的主場；"Pairing voice, visuals, and touch" |
| Story Stream（Best Multimodal Bedtime） | 沉浸式睡前故事 | https://devpost.com/software/story-stream | 場景明確（睡前）、多模態 |
| Voice Blast（2021 Beyond Voice Grand Prize） | 名人聲音猜謎遊戲，聲畫結合 | https://voicebot.ai/2021/01/29/celebrity-voices-game-wins-first-multimodal-alexa-skills-challenge/ | 好玩、聲畫結合（[來源：Voicebot 報導，未逐頁核對 Devpost]） |
| Smart Elephant（2017 Alexa Skills Challenge Grand Prize） | — | https://voicebot.ai/2017/07/03/multi-model-sweep-amazon-alexa-skill-contest-smart-elephant-wins/ | [來源：搜尋摘要，未展開] |

共同點：**語音優先、有一塊讓人一眼看懂的螢幕、場景具體（廚房 / 睡前 / 派對）、好玩**。

## 7. 人工步驟（HITL：只有人能做的）

| 步驟 | 在哪裡做 | 最晚什麼時候（北京時間） |
| --- | --- | --- |
| 登入 / 註冊 Devpost，點 "Join hackathon" | https://amazonappdev2026.devpost.com/ | 越早越好；最晚 10-23 20:00 |
| 準備可上傳公開視頻的 YouTube（或 Vimeo）帳號 | youtube.com / vimeo.com | 10-23 12:00 前可用 |
| 上傳演示視頻（設 Public），把鏈接回帖到賽道單 | YouTube / Vimeo | 10-23 20:00（官方提醒別拖到最後） |
| 照 `docs/05-SUBMISSION.md` 逐欄貼進 Devpost 表單、點 Submit | Devpost "Enter a Submission" | **10-24 01:00**（硬截止 03:00） |
| 截止後到 12-04 前不改倉庫與視頻 | — | 10-24 03:00 起 |

## 8. 風險與未知

- 57,232 名報名者，競爭極大；評委可只看視頻與文字 → 視頻是勝負手。
- 規則頁有 Cloudflare 驗證，自動化工具讀不到；後續核對請用有頭瀏覽器。
- 私有倉庫路徑需在提交時加 5–6 位評審協作者且對方要接受邀請；公開倉庫零步驟 → 傾向提交前轉公開（轉公開前做一次密鑰稽核）。
- 「Final stretch」更新寫 "Did you provide a link to your public code repository, with an open source license visible at the top?"，與規則「也可私有」並存；以規則為準，但公開更穩。
- AWS Builder mini challenge 需要 AWS 帳號與計費（額度已發完），本輪不作為目標（見 SPEC §10）。
- 獎金支付：須填 W-8BEN 類表格，可能預扣稅，電匯手續費自理（`/rules` §8 "Fees & Taxes"）。
