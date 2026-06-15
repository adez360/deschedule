# IDEA-11 標準班表 + 每週自動提交可用時段

## 需求（2026-06-15，使用者提案）

1. **每位員工都要維護一張「標準（常態）可用時段表」** —— 每個人都得排一個表。
2. **每週五系統自動把這張表「上傳」到下週的排班週** —— 不用每週手動重填，到截止點自動帶入下一個要排的週次，作為該週排班的可用時段基礎。

目標：管理者不必每週追著大家填表；只要員工設好一張常態表，系統就會在每週截止點自動把它套用到即將排班的那一週。

---

## 現況盤點（與既有半成品的關係）

這三個欄位/元件都已存在，但都**只做了一半**，本提案是把它們串起來：

| 既有物件 | 現況 | 落差 |
|---|---|---|
| `Availability.is_default_template`（`models/availability.py`） | 欄位存在，每位員工最多一筆；PUT 時會 `_unset_default_template` 確保唯一 | model 註解寫「缺的週自動從模板複製」，但 `_get_weeks()` 只回已存在紀錄，**自動複製從未實作**（todo.md Phase 2「預設時段模板功能」仍待辦）。**決策 G2 將此旗標改為獨立的 `AvailabilityTemplate` 表** |
| `Availability.locked` | 欄位 + `PATCH /users/{id}/availability/{week}/lock`；鎖住後員工 PUT 回 423 | 只能手動逐筆鎖，沒有「到截止自動鎖」 |
| `ScheduleDeadlineConfig`（`models/demand.py`） | 每店一筆，`days_before_week_start`（預設 2 = 週六）+ `deadline_time`（預設 23:59）；有 `/settings/deadline` GET/PUT | **只是存著的設定值，沒有任何程式執行它** —— 沒有排程任務在截止時鎖表或提醒 |
| `app/worker.py` Celery | 只有空的 `celery_app`（broker/backend = Redis） | **沒有任何 task、沒有 beat 排程**；需新增 beat + 任務 |

---

## 提案流程

```
員工 → 設定「標準週模板」(AvailabilityTemplate，每人一筆，見決策 G2)
                         │
   每週固定時間（截止點，預設週五）Celery beat 觸發
                         │
   對「下一個要排班的週」逐一檢查每位在職員工：
     - 該週已有手動填寫的 Availability → 保留，不覆蓋
     - 該週沒有紀錄          → 從 AvailabilityTemplate.slots 複製建立該週 Availability
                         │
   （可選）把該週所有員工的 Availability 標記 locked
                         │
   產出「未設定標準模板 / 未填表」名單，供提醒
```

---

## 待決策面向（提案階段，尚未定案）

### A. 「自動上傳」的觸發時機
- **A1 綁定 `ScheduleDeadlineConfig`**：用既有的 `days_before_week_start` + `deadline_time` 算出每店截止點（預設週六 23:59），beat 每小時掃描、到點才跑。最貼近現有設計，但使用者明確說「週五」→ 預設值可能要從 2 改成 3（週五）。
- **A2 固定每週五某時刻**：beat 直接 `crontab(day_of_week='fri', hour=..)`，簡單但忽略每店可自訂的截止設定。
- **A3 混合**：beat 每小時跑，逐店比對各自的截止設定 → 支援不同門市不同截止日。**（建議）**

> 決策重點：截止/自動提交是**全組織統一**還是**逐門市**？逐門市的話要以員工的 `home_store_id` 對應的店截止設定為準（浮動人力 home_store = NULL 需另定預設）。

### B. 「下一個要排班的週」如何界定
- B1 永遠是「下週」（執行日所在週 + 1）。
- B2 截止設定回推：`target_week_monday = deadline_date + days_before_week_start`。與 `ScheduleDeadlineConfig` 語意一致。**（建議，配 A3）**

### C. 自動帶入後的覆寫規則
- C1 **只補空缺**：員工已手動填該週 → 保留；沒填 → 用標準模板。**（建議，最安全）**
- C2 一律以標準模板覆蓋（員工當週的臨時調整會被洗掉，不建議）。
- C3 標準模板為底，員工臨時調整以「diff」疊加（複雜，先不做）。

### D. 自動帶入後是否鎖定
- D1 帶入後立即 `locked = true`（截止即定案，符合「截止」語意）。
- D2 帶入但不鎖，員工仍可在排班產生前微調（彈性高）。
- D3 帶入後不鎖，**另由排班 publish 時才鎖**（與現有 published 視為固定佔用的邏輯一致）。**（建議）**

### E. 「每個人都要排表」要強制到什麼程度
- E1 **軟性**：沒設標準模板的員工，自動提交時跳過 + 列入「未設定」名單給管理者提醒（Email/通知，可接 Phase 2「Email 通知系統」）。**（建議起步）**
- E2 **半強制**：沒填表者，該週以「全空（不可用）」帶入並標記，排班器自然排不到他。
- E3 **硬性**：登入後若無標準模板，強制導去 `/availability` 設定（體驗較差，先不做）。

### F. 標準模板 vs 逐週表的 UI
- 現在 `/availability` 是逐週編輯。需要一個明確的「設為我的標準週表」入口（沿用 `is_default_template`），並讓員工看出「這張會在每週五自動帶到下週」。
- 員工可隨時改標準模板；只影響**下一次**自動提交，已帶入/已鎖的週不回溯。

### G. 模板的儲存方式（單表旗標 vs 獨立表）

現況 `Availability` 用 `is_default_template` 布林旗標區分模板與逐週表，**同一張表**。問題：`week_start` 為 NOT NULL，模板列被迫佔用一個真實週次 → (1) 同一列「模板」與「該週實際可用時段」語意疊加；(2) 自動帶入下週時若該週恰為模板佔用的週，會自我覆蓋／判斷混亂。

- G1 **維持單表 + 旗標**（現況）：模板列 `week_start` 用哨兵週一值，查詢/UI 都要把它排除在真實週次外。最省事，但語意髒、邊界條件多。
- G2 **模板獨立成新表 `AvailabilityTemplate`**（`user_id` + `slots`，無 `week_start`，每人唯一）：語意乾淨，模板就是模板、週次就是週次；自動帶入時從模板表複製成 `Availability` 列。需加表 + migration。

#### ✅ 已決策（2026-06-15）：**G2 獨立表**

- 新增 `AvailabilityTemplate`：`id` / `user_id`（unique，每人一筆）/ `slots` `bool[7][24]` / `updated_at`；with `User.availability_template` 一對一關聯。
- 移除 `Availability.is_default_template` 欄位與相關 `_unset_default_template` 邏輯（migration drop column）。
- 自助 API：`GET/PUT /users/me/availability-template`；管理者：`GET/PUT /users/{user_id}/availability-template`。
- 自動提交任務改從 `AvailabilityTemplate` 讀取，複製成目標週的 `Availability` 列（`is_default_template` 旗標不再存在，複製出的列就是純粹的逐週紀錄）。
- 「未設定標準模板」= 該員工沒有 `AvailabilityTemplate` 列（E1 名單判定依據）。

---

## 實作草圖（待決策後再動工）

1. **Celery beat**（A2）：`app/worker.py` 加 `beat_schedule`，`crontab(day_of_week='fri', hour=23)` 觸發 `auto_submit_availability`（時區已設 `Asia/Taipei`）。需要在 docker-compose 補 `celery beat` + `celery worker` 服務（目前未跑）。
2. **`AvailabilityTemplate` 表**（決策 G2）：新增 model + migration（create table、`Availability` drop `is_default_template`、add `auto_filled`）；自助/管理 API `GET/PUT .../availability-template`。
3. **任務 `auto_submit_availability`**（A2 + B2 + C1 + D3 + E1）：
   - `target_week_monday = monday_of(today) + 7d`；
   - 逐組織撈在職員工（依 `home_store_id` / 角色群組涵蓋，沿用 IDEA-10 G1 範圍邏輯）；
   - 對每位員工：該週無 `Availability` 且有 `AvailabilityTemplate` → 從 template 複製建立（`auto_filled=true`）；無 template → 記入未設定名單；
   - 寫 log；回傳未設定名單供未來通知。
4. **「標準週表」UI**：`/availability` 加第三個 tab + 說明文案 + 空狀態提示；週檢視顯示 `auto_filled` 標記；共用 `components/shared/availability-grid.tsx`。

---

## 關聯
- 直接補完 todo.md Phase 2「預設時段模板（`is_default_template`）功能」。
- 截止提醒可併入 Phase 2「Email 通知系統（含截止提醒）」。
- 自動帶入的週次即 IDEA-10 `run_greedy_org` 排班的輸入週；範圍判定沿用 IDEA-10 G1（`home_store_id` + 跨店群組）。
- 鎖定/published 不回溯，與 IDEA-10「published/archived 視為固定佔用」一致。

## ✅ 最終決策（2026-06-15）

**A2 + B2 + C1 + D3 + E1 + F + G2**

| 面向 | 選定 | 說明 |
|---|---|---|
| A 觸發時機 | **A2** | Celery beat 固定每週五觸發（`crontab(day_of_week='fri')`，`Asia/Taipei`）。不讀每店 `ScheduleDeadlineConfig` → 全組織統一時點，最簡單。`days_before_week_start` 預設值不需更動（A2 不依賴它） |
| B 目標週 | **B2** | 配合 A2，目標週 = 執行日所在週的下一週週一：`target_week_monday = monday_of(run_date) + 7d`。語意即「下週」 |
| C 覆寫規則 | **C1** | 該週已有 `Availability`（不論手填或前次自動帶入）→ 保留不覆蓋；無紀錄才從模板複製 |
| D 鎖定 | **D3** | 自動帶入後**不鎖**，員工仍可調整；鎖定交由排班 publish 流程（沿用「published 視為固定佔用」） |
| E 強制程度 | **E1** | 無模板者跳過 + 記入「未設定」名單；任務回傳名單供未來通知（Email 系統尚未做，先寫 log） |
| F UI | **F** | `/availability` 新增「標準週表」分頁（第三個 tab），共用 `AvailabilityGrid`；週檢視顯示「由標準週表自動帶入」標記；空狀態提示未設定模板 |
| G 模板儲存 | **G2** | 獨立 `AvailabilityTemplate` 表（見上節）；移除 `Availability.is_default_template` |

### UI 標記附帶資料變更
為了讓週檢視能標示「此週由模板自動帶入」（ask F-2），`Availability` 新增 `auto_filled: bool`（預設 false）：自動提交任務建立的列設 `true`；員工經 `PUT` 手動儲存後設回 `false`。

## ✅ 已實作（2026-06-15）

- **model**：`AvailabilityTemplate`（`models/availability.py`，每人一筆）；`Availability` 移除 `is_default_template`、新增 `auto_filled`；`User.availability_template` 一對一
- **migration `a1b2c3d4e5f6`**：建 `availability_templates`、`availabilities` add `auto_filled` / drop `is_default_template`；升級時把舊 `is_default_template=true` 列搬進新表（已套用至 dev DB → head `a1b2c3d4e5f6`）
- **schemas**：`AvailabilityTemplateSet` / `AvailabilityTemplateResponse`；`AvailabilityResponse.auto_filled`
- **API**：`GET/PUT /users/me/availability-template`、`GET/PUT /users/{user_id}/availability-template`；手動 PUT availability 時 `auto_filled=False`
- **scheduler**：`load_org_inputs` 改由 `AvailabilityTemplate` 取 fallback（具體週優先、否則用模板）
- **Celery**：`app/tasks/availability.py` `auto_submit_availability`（A2+B2+C1+D3+E1）；`worker.py` `beat_schedule` 週五 23:00；docker-compose 新增 `celery-beat` 服務
- **前端**：`/availability` 新增「標準週表」分頁（空狀態提示 + 每週五自動帶入說明）；週檢視顯示 `auto_filled`（Sparkles 標記 +「由標準週表自動帶入」badge）；`availability-api.ts` 模板 fetch/save、`types` 同步
- **驗證**：task 邏輯端到端測過（設模板 → 建立下週 `auto_filled` 列 120h → 重跑不覆蓋）；worker 已註冊 task、beat 已啟動

### 尚未做（後續）
- E1 的「未設定名單」目前只寫 log；Email/站內通知待 Phase 2 通知系統
- employees 可用時段 tab 的管理者模板編輯 UI（API 已具備 `GET/PUT /users/{id}/availability-template`，UI 待接）

## 狀態
**已實作（2026-06-15）**
