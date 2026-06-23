# TODO（2026-06-15 盤點）

## ✅ 瀏覽器實測驗證日誌（2026-06-17，localhost:3000，admin + 純員工 li@example.com）

> 清驗證債：已 commit 但未實測的 5 項功能全數通過瀏覽器端到端驗證。測完已將所有測試資料還原原狀。
>
> - **IDEA-15 常態人力需求**：✅ 標題「常態人力需求」、**無週切換器/「從上週複製」**；編輯週一 07:00（1→3，總數 168→170）→儲存→重整後仍為 3（後端 GET 持久化）→還原回 1（總數 168）；技能色點顯示於格內；**自動排班讀常態需求**：對 6/22 空草稿跑「自動排班」（org 聯合排班）產出門市A 112／B 56／C 53 = 221 班次（已清空還原）。註：先前 6/22 產 0 班次是因該週無 availability（非 bug），複製 6/15 可用時段後即正常產出。
> - **IDEA-14 班表雙入口**：✅ **管理版**（admin）：覆蓋率分頁能力需求疊加角標 —— 暫移除 admin「日結帳」技能後，門市A 6/08 每日 14:00 格右上出現 ⚠️、tooltip 顯示「缺能力：日結帳」、圖例多出「缺能力標籤」；還原技能後消失。**員工版**（li，純員工）：標題「我的班表」、週曆/圖表雙模式、依 `Store.color` 分色（門市A 藍）、跨店彙整（6/01 週 26 小時 = DB 26 班次）、僅顯示已發佈/封存、iCal + 全螢幕。
> - **IDEA-13 側邊欄三組**：✅ admin（`system.all`）見全部三組；**純員工 li 只見「個人」組**（排班管理 / 組織設定 全隱藏）—— 權限分層正確；「門市偏好」深連結直達 `/availability?tab=preferences`（分頁啟用、側欄 active）。⚠️ 中間層「排班管理者」帳號 seed 無此資料，未測（只有 system.all 與純員工兩層）。
> - **門市管理（負責人+代表色）**：✅ 編輯門市B 設負責人（吳雅婷）+ 綠色（#059669）→儲存→重整後卡片顯示綠 accent + 吳雅婷（DB 確認 color=#059669/manager=吳雅婷）→還原為 NULL。
> - **IDEA-11 標準週表 + 週五自動提交**：✅ 標準週表分頁渲染（「每週五自動帶入下一週」說明 + 尚未設定提示）；建立 9 格模板→儲存→重整持久化；手動觸發 beat task `auto_submit_availability` → 回傳 `target_week=2026-06-22, created=1`、回報 7 位無模板員工（決策 E1）；可用時段 6/22 週顯示「✨ 由標準週表自動帶入」badge + 週籤 ⚡ 標記 + 說明文字，格子為模板內容；測完刪除模板 + auto_filled 列還原。
>
> 環境註記：本次登入表單填寫順利（未受密碼管理器 iframe 干擾，與 IDEA-12 實測時不同）。務必用 `localhost:3000`。

## 🟢 已 commit（2026-06-16）

> `773e0d2` 側邊欄重整（IDEA-13）、`d3f823e` 門市負責人 + 代表色（5.3.3）。
> **瀏覽器實測（localhost:3000，✅ 全數通過）**：側邊欄三組顯示正確、`system.all` 超管可見全部項目；
> 門市卡片色彩 accent + 負責人列正常；編輯門市 → 設定負責人（吳雅婷）+ 改代表色（紅）→ 儲存 → 重整後持久化正確。
> 註：務必用 **`localhost:3000`**（前端直連）而非 nginx `localhost:80` —— 後者會讓 NextAuth client session 抓不到
> access_token（`ClientFetchError`），全站資料載不進來。實測完已將 門市A 還原（manager=None, color=#2563EB）。

- **常態人力需求（IDEA-15，已 commit `1c681bd`；2026-06-17 瀏覽器實測通過，見頂部）**（決策 G1 純常態、不留逐週差異，見 `ideas/idea-15-standing-demand.md`）：
  人力需求表改為**常態表**，每店設定一次後每週沿用，不再以 `week_start` 為鍵。
  - 後端：`DemandTemplate` 去 `week_start`、`store_id` 改唯一；`StoreSkillDemand` 唯一鍵改 `(store_id, skill_id)`；
    `GET/PUT /stores/{id}/demand`、`GET/PUT/DELETE /stores/{id}/skill-demand` 去掉週參數；刪除 `copy-from/{week}` 端點
    與 `_assert_monday`；`scheduler.py` 需求查詢去週過濾（每店單筆）。migration `d6e7f8a9b0c1`（**新 head**，已套用 dev DB，
    去重保留 `updated_at` 最新一筆）
  - 前端：`/settings/demand` 移除週切換器 + 「從上週複製」按鈕，標題改「常態人力需求」；`demand-api.ts`/`skills-api.ts`
    去週參數；`schedules/page.tsx` 覆蓋率疊加層的 `fetchDemandMaybe`/`fetchSkillDemand` 同步去週
  - 驗證：✅ FE typecheck（僅餘 2 個既有 Base UI `Select.onValueChange` 型別誤差）；後端 compile + 熱重載乾淨、
    OpenAPI 新路由正確；migration 套用後實測每店塌縮為 1 列、`week_start` 欄移除、新唯一鍵就位；
    登入後 `GET /demand` 回傳 `{id, slots, store_id, updated_at}`（無 `week_start`）✅
  - 待辦：瀏覽器實測（編輯常態需求 → 儲存 → 重整持久化；技能標籤；自動排班讀常態需求）

- **門市管理頁面擴充（PLAN §5.3.3 item 2）**：`/settings/stores` 清單 + CRUD 原已實作；本次新增
  `Store.manager_user_id`（門市負責人，FK users `ON DELETE SET NULL`）+ `Store.color`（門市代表色 hex）。
  - 後端：`models/store.py` + `schemas/store.py`（Create/Update/Response 三者）+ `stores.py` PATCH 兩欄可清空；
    migration `c5d6e7f8a9b0`（**新 head**，已套用至 dev DB）
  - 前端：`schedules-api.ts` StoreDTO + `stores-api.ts` StoreBody 加兩欄；dialog 加負責人下拉（`fetchOrgUsers`）+
    8 色代表色選擇器；卡片顯示色彩 accent（頂部色條 + icon 底色）+ 負責人姓名
  - 驗證：✅ FE typecheck 乾淨、後端 schema/import 載入、migration head、ORM round-trip（寫入 FK+color → 還原）通過
  - 待辦：瀏覽器實測（新增/編輯設定負責人+代表色、清單顯示）；門市班表檢視（item 3）已於 IDEA-14 完成 ↓

- **班表檢視雙入口（IDEA-14，已 commit `9a2073d`；2026-06-17 瀏覽器實測通過，見頂部）**（決策 A1+B1+C1+D1+E1+F+G3，見 `ideas/idea-14-store-schedule-view.md`）：
  `/schedules` 依權限分流（A1，同一路由）。**管理版**（`store.schedule.edit`/`org.schedule.arrange`/`org.schedule.view_all`/`system.all`）
  維持原有作業 + 覆蓋率分頁新增能力需求疊加角標（E1：`AlertTriangle` + tooltip，前端 `fetchSkillDemand` + 批次
  `fetchUserSkills` 現算缺哪些能力，無新後端端點，獨立於人數需求判定）。**員工版**（其餘登入者，標題「我的班表」）：
  新 `_components/employee-schedule.tsx`，週曆（預設、依 `Store.color` 分色）+ 圖表雙模式（B1），跨門市彙整自己
  當週班次（C1）、僅含已發佈/已封存、保留 iCal 訂閱 + 全螢幕。`Store.manager_user_id` 不連動（G3）。純前端、無 migration。
  - 驗證：✅ FE typecheck（新增碼乾淨；僅餘 2 個既有 Base UI `Select.onValueChange` 型別誤差，非本次引入）
  - 待辦：瀏覽器實測 — ① 管理者帳號看管理版 + 覆蓋率缺能力角標；② 一般員工帳號看「我的班表」週曆/圖表（只看自己、分色）

- **IDEA-13 左側導覽列重整**（決策 A1+B1+C1+D優化，見 `ideas/idea-13-sidebar-nav-redesign.md`）：
  `app-sidebar.tsx` 改三組 `個人 / 排班管理 / 組織設定`；`排班時段`→`我的可用時段`、`門市偏好`圖示改 `Heart`；
  Header 品牌圖示 + footer `SidebarSeparator` + 各項 `tooltip`。純前端、無 API/DB 變動。
  - `門市偏好` 實為 `/availability` 分頁（非獨立頁）：改深層連結 `?tab=preferences`，`/availability` Tabs 改 URL 驅動
    （`router.replace`），側欄 active 讀 `?tab` 區分；`useSearchParams` 用 `<Suspense>` 包住（layout 的 sidebar + 頁面）。
    移除空的 `/preferences` stub 目錄。
  - **人員管理權限修正**：原只在 `showManager`（排班權限）下顯示，導致純組織管理員看不到。新增 `showPeople`
    （排班者 / `org.manage` / `system.all` / `org.employee.manage` 皆可見）。
  - 待辦：瀏覽器實測（三種權限層級 — 一般員工 / 排班管理者 / 組織管理員 — 的分組可見性；點「門市偏好」直達分頁）
  - 已同步更新 `PLAN.md` §10 Phase 2（並補登 IDEA-10、IDEA-11 進路線圖）

## 🟢 已 commit（`dd347ef`，2026-06-15）

> IDEA-11 與 IDEA-12 因 `user.py` / `models/__init__.py` 改動交錯，合併為單一 commit `dd347ef`。

- **IDEA-11 標準班表 + 每週自動提交可用時段**（決策 A2+B2+C1+D3+E1+F+G2，見 `ideas/idea-11-default-schedule-auto-submit-availability.md`）：
  - `AvailabilityTemplate` 獨立表（每人一筆）；`Availability` 移除 `is_default_template`、新增 `auto_filled`
  - migration `a1b2c3d4e5f6`（**新 head**，已套用至 dev DB）：建表 + 欄位調整 + 搬移舊 default-template 列
  - API：`GET/PUT /users/me/availability-template` + 管理者 `/users/{id}/availability-template`
  - Celery：`tasks/availability.py::auto_submit_availability` + `worker.py` beat（週五 23:00 Asia/Taipei）；
    docker-compose 新增 `celery-beat` 服務（專案第一個排程任務）
  - `scheduler.py` fallback 改讀 `AvailabilityTemplate`
  - 前端：`/availability` 新增「標準週表」分頁 + 週檢視 `auto_filled` 標記
  - 驗證：task 邏輯端到端測過（建立下週 auto_filled 列、重跑不覆蓋）；worker 註冊 task、beat 已啟動
  - 後續：未設定名單通知（待 Email 系統）、管理者模板編輯 UI（API 已備、UI 待接）

- **IDEA-12 員工註冊／入職流程**（決策 A1+B1+C2+D1+E2+F 簡化，見 `ideas/idea-12-employee-registration-onboarding.md`）：
  - `User` 新增 `invite_token`(unique) + `invite_expires_at`；`hashed_password` 改 nullable
  - migration `b3c4d5e6f7a8`（**新 head**，已套用至 dev DB）
  - API：`POST /organizations/{org}/users` 改不收密碼、回傳 `InviteResponse`；`POST .../users/{id}/resend-invite`（重發／密碼重設）；公開 `GET/POST /onboard/{token}`；`auth.login` 防 null 密碼
  - 前端：`add-employee-dialog` 移密碼欄 + 複製邀請連結步驟；`/employees` 待啟用 badge + 邀請連結鈕；新 `(auth)/onboard` 公開頁；`middleware.ts` 白名單
  - 驗證：✅ curl + 瀏覽器端到端測過（新增→複製連結→`/onboard` 預填+設密碼→啟用 204→待啟用 badge 消失→後端登入 200；token 重用 404；pending 登入 401；resend 密碼重設）。註：`/onboard`、`/login` 密碼欄會觸發本機密碼管理器擴充注入 iframe，擋住 CDP 截圖/點擊，故「送出按鈕點擊」與 NextAuth UI 登入改以 API 驗證資料流（環境限制，非程式問題）
  - 後續：A2 email 自動寄送（待通知系統）、入職後可選引導去設標準週表

## ✅ 已完成並 commit

- **IDEA-10 全組織聯合排班**（`81b5a9c`）：`scheduler.py` → `load_org_inputs` + `run_greedy_org`；
  `POST /organizations/{org_id}/schedules/generate`；`Store.cross_group`（migration `f7a8b9c0d1e2`）+ `/settings/stores` UI
- **每位員工每日排班上限**（`81b5a9c`，IDEA-10 § H）：`User.daily_hour_max`（migration `e5f6a7b8c9d0`，
  NULL = 預設 8 小時，跨門市總和）；排班器納入 `daily_caps`；`/availability` 偏好分頁輸入框
- **員工管理頁面重新設計 5.3.1**（`54f9069`）：清單 search/filter/sort/pin/group/多選 + 快速新增 +
  停用切換（soft-delete）；詳細頁分頁（個人資料·合約·可用時段·班表歷史·權限·技能）
- **共用元件抽出**：`AvailabilityGrid`（`f714da7`）、`StorePreferences`（`4080022`）
- `stores.py` / `users.py` PATCH 改 `exclude_unset`（讓 nullable 欄位可被清空）

## 🔶 待處理

- [ ] 端到端驗證（多門市自動排班 + 跨店群組 + daily cap 上限）— 尚未在瀏覽器實測
- [x] commit IDEA-11 + IDEA-12 變更（`dd347ef`）
- [x] IDEA-11 瀏覽器實測（標準週表分頁、auto_filled 標記、週五排程實際觸發）—— 2026-06-17 通過，見頂部驗證日誌
- [x] IDEA-12 瀏覽器實測（2026-06-15，見上；環境限制下送出/登入改以 API 驗證）

---

## Phase 2 剩餘項目（PLAN.md §10）

- [x] ~~班表 PDF 匯出~~ — **取消（2026-06-18 決策）**
- [x] ~~Email 通知系統（含截止提醒）~~ — **取消（2026-06-18 決策）**；IDEA-11「未設定標準模板」名單通知一併取消
- [x] 門市管理頁面（清單 + 管理介面 + 班表檢視，含 `Store.manager_user_id` / `Store.color`，PLAN §5.3.3）
      → 班表檢視（item 3）併入 IDEA-14 完成（見頂部）
- [x] 個人班表依門市分色檢視頁面（PLAN §5.3.2，可複用現有 iCal 機制）
      → IDEA-14 員工版「我的班表」週曆模式即此（依 `Store.color` 分色）；`ideas/IDEA-04.md` 規格併入 idea-14
- [x] employees 可用時段 tab 接上管理者模板編輯 UI（IDEA-11，API 已備）
      → `_components/template-tab.tsx`（讀寫 `/users/{id}/availability-template`，唯讀模式 gate `employee.availability.edit`）；
        員工詳細「可用時段」分頁新增「標準週表」區段（可用時段 → 標準週表 → 門市偏好）

---

## Phase 3 剩餘項目（PLAN.md §10）

- [x] **MILP/CP-SAT 求解器整合（OR-Tools，取代 greedy）**（2026-06-22，行為保留版）：
      `scheduler.solve_org_schedule()` dispatcher → 優先 `run_cpsat_org()`（CP-SAT 全域最佳解），
      OR-Tools 未裝／逾時（`scheduler_time_limit_seconds` 預設 10s）／例外 → 退回 `run_greedy_org()`（保留作 fallback）。
      約束集與 greedy 完全一致（可用性／單店單時／不超配／daily cap／能力覆蓋軟約束）；字典序加權整數目標（覆蓋 ≫ 能力 ≫ 偏好）。
      議題 1「最短連續工時」本版未納（留後續）。`ortools>=9.0` 解註解進 requirements.txt（鏡像需 `docker compose build backend`；已 live 裝入運行中容器測試）。
      `backend/tests/test_scheduler.py` 11 項單元測試全過；真實資料唯讀驗證（org 3 店/8 人/需求 280，週 6/15）：greedy 221 → **CP-SAT 228** 班次／約 640ms、無重複佔位、覆蓋 ≥ greedy。
      待辦：① 透過 generate endpoint 走一次 live 產生（會建草稿、需還原）+ 瀏覽器確認；② `docker compose build backend` 讓 ortools 進鏡像（目前只在運行中容器）。
- [ ] 跨週多週班表並排顯示
- [ ] 行動端 PWA 推播通知
- [ ] 薪資報表自動歸檔（班表 archived 時觸發 — 目前已有 `_create_payroll_reports()` 但需確認自動觸發是否完整）
- [ ] 多語系支援（zh-TW / en）
- [ ] 完整稽核日誌頁面（含鎖定後修改記錄）
- [ ] 效能調校與壓力測試
- [ ] AI 輔助班表審查（低優先度、唯讀、權限受限，PLAN §5.3.4，源自 `ideas/IDEA-01.md`）

---

## 開放議題（PLAN.md §11，待決策）

- [ ] **議題 1：最短連續工時** — 是否強制班次最少連續 2 小時？由組織或門市層級設定？

---

## 已完成（供參考，不需再做）

- Phase 1 全部完成（2026-06-05）
- 手動排班 v1 + IDEA-03 改版（跨日框選、批次指派/清除）
- 工時統計與薪資報表 IDEA-05 / IDEA-06（個人/門市雙視圖、加減項、home_store FT 歸屬）
- 個人資料擴充 IDEA-07（nickname/avatar/note/hire_date、`employee.identity.view` 顯示分級）
- 工作能力需求改版 IDEA-02（純標籤、與人數需求單表整合）
- 合約模型 v2/v3（依合約別分流、跨門市 org-level）
- JWT 過期自動登出、RoleGroup `store_ids[]` 多選範圍
