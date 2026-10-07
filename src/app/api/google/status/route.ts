import { googleConfigured, signedInEmail } from "@/lib/google/oauth";

export async function GET() {
  return Response.json({ configured: googleConfigured(), ...(await signedInEmail()) });
}
