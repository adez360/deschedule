const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type ContractType = "FT" | "PT" | "CUSTOM";

export interface ContractDTO {
  id: string;
  user_id: string;
  store_id: string;
  contract_type: ContractType;
  monthly_salary: string | null; // Decimal serialised as string — FT only
  hourly_rate: string | null; // Decimal serialised as string — PT only
  effective_from: string; // "YYYY-MM-DD"
  effective_until: string | null;
  created_at: string;
}

export interface ContractSetBody {
  contract_type: ContractType;
  monthly_salary: string | null;
  hourly_rate: string | null;
  effective_from: string;
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const jsonH = (token: string) => ({ ...auth(token), "Content-Type": "application/json" });

export const fetchActiveContract = (
  userId: string,
  storeId: string,
  token: string,
): Promise<ContractDTO | null> =>
  fetch(`${API}/api/users/${userId}/stores/${storeId}/contract`, { headers: auth(token) })
    .then(r => {
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`${r.status}`);
      return r.json();
    });

export const fetchUserContracts = (userId: string, token: string): Promise<ContractDTO[]> =>
  fetch(`${API}/api/users/${userId}/contracts`, { headers: auth(token) })
    .then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); });

export const upsertContract = (
  userId: string,
  storeId: string,
  body: ContractSetBody,
  token: string,
): Promise<ContractDTO> =>
  fetch(`${API}/api/users/${userId}/stores/${storeId}/contract`, {
    method: "PUT",
    headers: jsonH(token),
    body: JSON.stringify(body),
  }).then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); });
