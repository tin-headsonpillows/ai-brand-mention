import { redirect } from "next/navigation";

/** The bare domain opens the first section; every section has its own bookmarkable URL. */
export default function Home() {
  redirect("/google-search-tracking");
}
