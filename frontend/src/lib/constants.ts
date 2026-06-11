export const DAYS = ["一", "二", "三", "四", "五", "六", "日"];

// Display order: 07:00 → 06:00 (next day). Index i maps to actual hour (i+7)%24.
export const DISPLAY_HOURS = Array.from({ length: 24 }, (_, i) => (i + 7) % 24);
