import { redirect } from "next/navigation";

export default function PreferencesPage() {
  redirect("/availability?tab=preferences");
}
