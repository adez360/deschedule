# TODO（2026-06-15 盤點）

## 🟡 待 commit（2026-06-16）

- **門市管理頁面擴充（PLAN §5.3.3 item 2）**：`/settings/stores` 清單 + CRUD 原已實作；本次新增
  `Store.manager_user_id`（門市負責人，FK users `ON DELETE SET NULL`）+ `Store.color`（門市代表色 hex）。
  - 後端：`models/store.py` + `schemas/store.py`（Create/Update/Response 三者）+ `stores.py` PATCH 兩欄可清空；
    migration `c5d6e7f8a9b0`（**新 head**，已套用至 dev DB）
  - 前端：`schedules-api.ts` StoreDTO + `stores-api.ts` StoreBody 加兩欄；dialog 加負責人下拉（`fetchOrgUsers`）+
    8 色代表色選擇器；卡片顯示色彩 accent（頂部色條 + icon 底色）+ 負責人姓名
  - 驗證：✅ FE typecheck 乾淨、後端 schema/import 載入、migration head、ORM round-trip（寫入 FK+color → 還原）通過
  - 待辦：瀏覽器實測（新增/編輯設定負責人+代表色、清單顯示）；**門市班表檢視（item 3）尚未做** —— 下一步候選

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
- [ ] IDEA-11 瀏覽器實測（標準週表分頁、auto_filled 標記、週五排程實際觸發）
- [x] IDEA-12 瀏覽器實測（2026-06-15，見上；環境限制下送出/登入改以 API 驗證）

---

## Phase 2 剩餘項目（PLAN.md §10）

- [ ] 班表 PDF 匯出
- [ ] Email 通知系統（含截止提醒）— **IDEA-11 的「未設定標準模板」名單通知併入此項**
- [ ] 門市管理頁面（清單 + 管理介面 + 班表檢視，含 `Store.manager_user_id` / `Store.color`，PLAN §5.3.3）
- [ ] 個人班表依門市分色檢視頁面（PLAN §5.3.2，可複用現有 iCal 機制）
      → 對應 **`ideas/IDEA-04.md`「個人班表檢視」**，目前該文件只有一行標題，需要展開規格
- [ ] employees 可用時段 tab 接上管理者模板編輯 UI（IDEA-11，API 已備）

---

## Phase 3 剩餘項目（PLAN.md §10）

- [ ] MILP 求解器整合（OR-Tools CP-SAT，取代 greedy）
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
