import { signOut } from "@/lib/google/oauth";

export async function POST() {
  await signOut();
  return Response.json({ ok: true });
}
