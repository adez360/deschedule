"use client";

import { useQueryClient } from "@tanstack/react-query";
import type { StoreDTO } from "@/lib/schedules-api";
import { fetchUserPreferences, saveUserPreferences } from "@/lib/preferences-api";
import { updateUser } from "@/lib/users-api";
import { StorePreferences } from "@/components/shared/store-preferences";

export function PreferencesTab({
  userId, token, storeList, dailyHourMax, editable,
}: {
  userId: string;
  token: string;
  storeList: StoreDTO[];
  dailyHourMax: number | null;
  editable: boolean;
}) {
  const qc = useQueryClient();

  return (
    <StorePreferences
      storeList={storeList}
      editable={editable}
      enabled={!!userId && !!token}
      prefsQueryKey={["userPreferences", userId]}
      fetchPreferences={() => fetchUserPreferences(userId, token)}
      savePreferences={(prefs) => saveUserPreferences(userId, prefs, token)}
      dailyHourMax={dailyHourMax}
      saveDailyHourMax={(cap) => updateUser(userId, { daily_hour_max: cap }, token)}
      onSaved={() => {
        qc.invalidateQueries({ queryKey: ["userPreferences", userId] });
        qc.invalidateQueries({ queryKey: ["orgUsers"] });
      }}
    />
  );
}
