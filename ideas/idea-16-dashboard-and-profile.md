# IDEA-16：首頁（Dashboard）與個人資料頁（Profile）內容規劃

> **狀態：✅ 已實作（2026-06-18）**，決策組合 **A1 + B分層 + C補改密碼 + D帳號中樞 + E死連結暫留**（詳見 §3）。實作狀態與延後項見 §5。
>
> 觸發原因：盤點時發現兩頁幾乎是空的——
> - `/dashboard`（首頁）目前只有 `<h1>首頁</h1>` + 「歡迎回來，{name}」一行，**沒有任何內容**。
> - `/profile`（個人資料）側欄 `personalNav` 有連結（`app-sidebar.tsx:62`），但 **`(dashboard)/profile/` 路由根本不存在 → 死連結（404）**。自助式個人頁從未建立。

---

## 0. 現況盤點（這兩頁不該重複造的輪子）

「個人」側欄組已經有 4 個獨立頁，**首頁/個人頁都不該重做它們，只該連出去或摘要**：

| 既有自助頁 | 路由 | 後端 |
|------|------|------|
| 我的班表 | `/schedules`（員工版） | `fetchScheduleList`/`Detail` 彙整、`/me/token` iCal |
| 我的可用時段 | `/availability` | `GET/PUT /users/me/availability/{week}`、`…/availability-template` |
| 門市偏好 | `/availability?tab=preferences` | `GET/PUT /users/me/preferences` |
| 薪資報表（個人） | `/payroll` | `GET /users/me/payroll` |

已有的自助端點：`GET/PATCH /users/me`（PATCH gated `self.profile.edit`，`note` 自助會被濾掉）、`GET /me/token`（iCal）。
`User` 可顯示/編輯欄位：`name`·`nickname`·`avatar_url`·`phone`·`home_store_id`·`hire_date`·`daily_hour_max`·`email`，以及唯讀的 `contracts`／`skill_assignments`／`role_groups`／`created_at`。

**真缺口（盤點時發現）**：**沒有自助改密碼端點**。目前員工要改密碼，唯一路徑是請管理者按 `resend-invite`（走密碼重設流程）。個人頁若要放「帳號安全」，需補 `POST /users/me/password`（驗舊密碼 → 設新密碼）。詳見 §3 開放決策 C。

---

## 1. 兩頁的定位（先把職責切乾淨，避免互相重疊 + 跟側欄重疊）

- **Dashboard / 首頁**：登入後的著陸點，回答「**我現在該知道什麼、該做什麼**」。glanceable 狀態 + 下一步動作，**不是** sidebar 的縮圖版捷徑牆。
- **Profile / 個人資料**：「**管理我自己的身份、帳號與設定**」的中樞，等於 `/employees` 詳細面板的「自助版鏡像」，但只對自己、且砍掉管理者欄位（`note`、啟用狀態、權限編輯）。

切割原則：**動態狀態 → 首頁；靜態身份/設定 → 個人頁**。班表/可用時段/薪資這些已有專頁的，兩邊都只摘要或連出去。

---

## 2. 候選內容

### 2A. Dashboard / 首頁 — 決策 A1（輕量：捷徑＋提醒）＋ B（角色分層疊加）

定調：首頁是**提醒卡 + 動作捷徑 + 輕量摘要**，不放需要現算的重 widget（工時圖表、即時覆蓋率缺口）。角色分層複用側欄現成判斷 `showManager`/`showAdmin`/`showPeople`（`app-sidebar.tsx`）。

**v1 範圍（所有員工，核心）**
1. **可用時段填寫提醒（殺手級）** — 下一排班週期是否已填 + **截止日倒數**。串 `/settings/deadline` + `GET /users/me/availability`，未填且逼近截止 → 紅色 CTA「立即填寫」。
2. **待辦/提醒匯總** — 標準週表未設定（`availability-template` 為 null）、合約即將到期等，逐條帶 CTA。
3. **下一個班次（單行提醒）** — 下一班哪天/幾點/哪間店。資料：員工版 `/schedules` 已有（`fetchScheduleList`/`Detail`），不另加圖表。
4. **快速動作捷徑** — 填可用時段 / 看班表 / 訂閱 iCal（少量、動作導向）。

**v1 管理者疊加（`store.schedule.edit` / `org.schedule.*`）**
5. **下一週排班進度提醒** — 負責門市中尚未發佈的班表 + 一鍵進 `/schedules`。資料：現有 `fetchScheduleList`，無需新端點。

**v1 組織管理員疊加（`org.manage` / `system.all`）**
6. **組織概況（輕量計數）** — 門市數、員工數（在職／待啟用／停用）。資料：現有 list 端點即可數，不現算。

**後續（v2，A1 暫不做——需現算或新增彙整端點，超出「輕量」範圍）**
- 本週工時摘要圖表。
- 可用時段回收率 + 未填名單 catch-list（需跨員工彙整端點）。
- 人力缺口快照（複用 IDEA-14 覆蓋率/能力需求判定，但屬即時計算）。

### 2B. Profile / 個人資料（自助帳號中樞）

1. **個人資料卡（可編輯）** — 頭像（先 URL，檔案上傳待 MinIO/S3）、姓名、暱稱、Email、電話、所屬門市、入職日（唯讀）。走 `PATCH /users/me`。**強烈建議與 `/employees` 個人資料分頁共用同一表單元件**，注入資料層（`/users/me` vs `/users/{id}`），比照 AvailabilityGrid / StorePreferences 的共用模式，避免兩套漂移。
2. **帳號安全** — 修改密碼（**需新端點，見決策 C**）。登出顯示已在側欄 footer，可不重複。
3. **我的合約（唯讀）** — 當前合約：時薪/月薪、起訖日。資料：`contracts`。
4. **我的技能（唯讀 badge）** — `skill_assignments`。
5. **我的身份組（唯讀 badge）** — `role_groups`，讓員工知道自己有哪些權限範圍。
6. **行事曆訂閱** — iCal 訂閱網址 + 複製鈕（`GET /me/token`，目前埋在 `/schedules`，個人頁是更自然的家）。
7. **設定捷徑** — 連到 可用時段 / 標準週表 / 門市偏好 / 薪資報表（這些不嵌入，只連出）。

> 注意：通知偏好**不放**——Email 通知系統已於 2026-06-18 取消（見 `todo.md`）。

---

## 3. 決策結果（2026-06-18，已拍板）

| # | 議題 | 決策 |
|---|------|------|
| **A** | 首頁深度 | **A1：純捷徑＋提醒**（輕、快）。重 widget（工時圖表/即時缺口/回收率）列 v2。 |
| **B** | 首頁角色分層 | **分層**：員工→管理者→管理員疊加卡片，複用側欄 `showManager`/`showAdmin` helper。 |
| **C** | 自助改密碼 | **現在補齊**：新增後端 `POST /users/me/password`（驗舊密碼），個人頁「帳號安全」接上。 |
| **D** | Profile 範圍 | **前者**：純帳號/身份中樞 + 連出去，不把可用時段等嵌進來。 |
| **E** | 死連結處理 | **先不動**：側欄 `/profile` 連結維持，直接把 `/profile` 頁做出來消除 404。 |

---

## 4. 實作拆解（待開工）

**後端（決策 C）**
- `POST /users/me/password`：body `{ current_password, new_password }` → 用既有 hash 驗 `current_password`、設新 `hashed_password`；`hashed_password IS NULL`（pending 帳號）回 400/409。沿用 `auth.py` 的雜湊工具。
- schema：`PasswordChangeRequest`；新增權限考量——任何已啟用本人皆可改自己密碼（不另設權限位，比照 `GET /users/me/payroll` 的「本人開放」原則）。

**前端 — `/profile`（決策 D，新頁）**
- 建 `(dashboard)/profile/page.tsx`。
- 個人資料卡抽成共用元件 `components/shared/profile-form.tsx`，`/profile` 與 `/employees` 個人資料分頁共用（注入資料層：`/users/me` vs `/users/{id}`），比照 AvailabilityGrid/StorePreferences 模式。
- 區塊：個資卡（可編輯，`PATCH /users/me`）、帳號安全（改密碼）、合約/技能/身份組（唯讀）、iCal 訂閱（`/me/token`）、設定捷徑。
- `users-api.ts` 加 `changeMyPassword()`。

**前端 — `/dashboard`（決策 A1 + B，改寫現有空頁）**
- 改寫 `(dashboard)/dashboard/page.tsx`（目前 server component，需改為含 client widget 的組合）。
- v1 卡片：① 可用時段＋截止日提醒　② 待辦匯總　③ 下一班次　④ 快速動作；管理者加 ⑤ 排班進度；管理員加 ⑥ 組織概況計數。
- 權限分層複用側欄 helper 邏輯（可抽 `lib/permissions.ts` 共用 `hasPermission`/`showManager` 等，避免與 `app-sidebar.tsx` 重複）。

**收尾**
- 登記到 `todo.md` 與 `PLAN.md` §10（§5.3.x 個人頁/首頁）。
- 瀏覽器實測：員工/管理者/管理員三層首頁卡片可見性；`/profile` 編輯＋改密碼端到端；改完還原測試資料。

## 5. 實作狀態（2026-06-18）

**已交付**
- 後端：`POST /users/me/password`（驗舊密碼；pending 帳號 409；新密碼 <8 字 422）+ `PasswordChangeRequest` schema。curl 驗證 400/204/422/登入仍 200。
- 共用 `lib/permissions.ts`（`hasPermission`/`isScheduleManager`/`isOrgAdmin`）；`app-sidebar.tsx` 改用之，消除重複的 inline 判斷。
- `users-api.ts`：`changeMyPassword()`。
- `/profile`（新頁，消死連結）：基本資料卡（暱稱/電話/頭像可編輯 → `PATCH /users/me`；姓名/Email/所屬門市/唯讀）、帳號安全（改密碼，含顯示密碼切換 + 即時驗證）、我的技能（唯讀 badge）、我的身份組（取自 session）、iCal 訂閱、設定捷徑。
- `/dashboard`（改寫）：待辦提醒（下一週可用時段未填 / 標準週表未設定，逐條 CTA；皆完成則顯示就緒態）、快速動作；管理者疊加「下一週排班進度」（各門市狀態角標）；管理員疊加「組織概況」計數（門市 / 在職 / 待啟用 / 已停用）。
- 瀏覽器 + curl 實測通過（admin 三層全顯示；profile 全區塊渲染；兩條表單 data path curl 驗證）。

**本次刻意延後（A1 輕量範圍外或相依未備）**
- **下一個班次 widget**（首頁）：需跨店班次彙整（複用 employee-schedule 邏輯，N 查詢），列 v2。
- **截止日倒數**（可用時段提醒）：目前只判「未填」未接 `/settings/deadline` 倒數，列 v2。
- **可用時段回收率 / 未填名單、人力缺口快照**（管理者）：需彙整端點或即時計算，v2。
- **合約唯讀區塊**（profile）：`GET /users/{id}/contract` 需 `employee.payroll.view`，純員工讀不到自己合約 → 待後端放寬「本人可讀自己合約」後再上。
- **共用 `profile-form.tsx` 抽出**：`/profile` 與 `/employees` 個資分頁目前各自實作；employees 頁的表單深嵌 1255 行 `DetailPanel`，抽取改寫風險高於效益，留作後續重構（兩者欄位集本就不同：自助無 `note`/啟用切換/門市指派）。

## 相關

- 個資欄位與姓名可見度分級：`idea-07-profile-extension.md`
- 側欄三組與 `personalNav`（含 `/profile` 連結出處）：`idea-13-sidebar-nav-redesign.md`
- 截止日體系（首頁提醒 widget 的資料源）：`/settings/deadline`
- 覆蓋率/能力需求判定（管理者缺口卡片複用）：`idea-14-store-schedule-view.md`
