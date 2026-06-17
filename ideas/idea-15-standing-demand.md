# IDEA-15 — 門市人力需求表改為常態表

## 一句話
人力需求表應該是**常態表**，店長設定一次後每週沿用，不需要每週重新填寫。

## 背景 / 問題
- `DemandTemplate` 雖然名為 *Template*，實際上以 `(store_id, week_start)` 為鍵 —— **每週一筆**。`StoreSkillDemand` 亦以 `(store_id, week_start, skill_id)` 為鍵。
- `/settings/demand` 整個介面圍繞「週切換器 + 從上週複製」打造，那顆「從上週複製」按鈕只是因為沒有常態表而存在的人工補丁。
- **排班器地雷**：`run_greedy_org` 的 `_load_inputs` 以 `week_start == week_start` 查需求，若某週沒有資料就退回**全 0 需求**（`scheduler.py`），結果是該店該週排出**空班表**且無提示。常態表直接消除這個失誤面。
- 這是 IDEA-11（員工可用時段改為常態 `AvailabilityTemplate`）的需求端對應。

## 決策（已與使用者確認）
**G1 — 純常態，不保留逐週差異（standing only）。**
- 需求表每店僅一筆，**不再有 `week_start`**，也沒有「本週特例 / 覆寫」。
- 排班器永遠讀該店的常態需求；技能子需求同理。
- UI 移除週切換器與「從上週複製」，只剩單一網格。
- 取捨：失去為特定忙週（節慶 / 活動）臨時加減人力的能力 —— 使用者接受，換取最簡模型。日後若要回到「常態 + 逐週覆寫」可另開 idea。

## 資料模型
```
demand_templates      (store_id UNIQUE)            -- int[7][24] 人數，每店一筆
store_skill_demands    (store_id, skill_id) UNIQUE  -- bool[7][24] 技能需求，每店每技能一筆
```
- 兩表皆移除 `week_start` 欄位與舊的含週唯一鍵。

## 變更清單
**後端**
- `models/demand.py`：`DemandTemplate` 移除 `week_start`，`store_id` 改唯一。
- `models/skill.py`：`StoreSkillDemand` 移除 `week_start`，唯一鍵改 `(store_id, skill_id)`。
- `schemas/demand.py` / `schemas/skill.py`：response 移除 `week_start`。
- `api/v1/store_config.py`：`GET/PUT /stores/{id}/demand`（去掉 `{week_start}`）；刪除 `copy-from/{source_week}` 端點與 `_assert_monday`。
- `api/v1/skills.py`：`GET/PUT/DELETE /stores/{id}/skill-demand`（去掉 `{week_start}`）；刪除 `_assert_monday`。
- `services/scheduler.py`：需求與技能需求查詢移除 `week_start` 過濾（每店單筆）。
- Alembic 遷移：去重（每店 / 每店每技能保留 `updated_at` 最新一筆）→ 丟欄位 → 換唯一鍵。

**前端**
- `lib/demand-api.ts` / `lib/skills-api.ts`：移除 `weekStart` 參數與 `copyDemandFromWeek`；DTO 去掉 `week_start`。
- `settings/demand/page.tsx`：移除週切換器、週日期副標、「從上週複製」按鈕；標題文案改為「常態人力需求」。
- `schedules/page.tsx`：`fetchDemandMaybe` / `fetchSkillDemand` 呼叫去掉週參數（IDEA-14 覆蓋層）。
- `types/index.ts`：`DemandTemplate` 去掉 `week_start`。

## 遷移注意
去重為**破壞性**操作：多週的需求列會塌縮成每店一筆（取 `updated_at` 最新者）。dev 資料可重填，影響可忽略。
