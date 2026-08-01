import { SignIn } from "@/components/screens/SignIn";
import { isSignInReason } from "@/lib/auth/account-status";

export const dynamic = "force-dynamic";

export const metadata = { title: "Sign in · Sightline" };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string; next?: string }>;
}) {
  const { reason, next } = await searchParams;

  return (
    <SignIn
      reason={isSignInReason(reason) ? reason : undefined}
      // Only ever a relative path; the route validates it again server-side
      // before trusting it, so a crafted absolute URL cannot become an open
      // redirect.
      redirectTo={next?.startsWith("/") ? next : undefined}
    />
  );
}
