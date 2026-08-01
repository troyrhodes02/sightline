import { redirect } from "next/navigation";

/**
 * The root has no content of its own. `/slate` is the landing surface, and the
 * authenticated layout there bounces an unauthenticated caller to sign-in — so
 * the decision lives in one place rather than being duplicated here.
 */
export default function Home() {
  redirect("/slate");
}
