import { SignIn } from "@clerk/nextjs";
import { cockpitReturnPath } from "@/lib/auth/return-path";

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ redirect_url?: string }> }) {
  const destination = cockpitReturnPath((await searchParams).redirect_url);
  return (
    <div className="flex min-h-screen items-center justify-center">
      <SignIn path="/sign-in" routing="path" withSignUp={false} forceRedirectUrl={destination} appearance={{ elements: { footerAction: "hidden" }, variables: { colorPrimary: "#b8f49b", colorBackground: "#181b1c", colorForeground: "#edf0ef" } }} />
    </div>
  );
}
