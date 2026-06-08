import { auth } from "@/lib/auth";

export default async function DashboardPage() {
  const session = await auth();

  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-semibold">首頁</h1>
      <p className="text-muted-foreground">
        歡迎回來，{session?.user.name ?? session?.user.email}
      </p>
    </div>
  );
}
