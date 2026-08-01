import { SignUp } from "@/components/screens/SignUp";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Request an account · Sightline",
  robots: { index: false, follow: false },
};

export default function SignUpPage() {
  return <SignUp />;
}
