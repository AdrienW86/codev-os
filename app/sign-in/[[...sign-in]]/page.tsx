import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <SignIn path="/sign-in" routing="path" withSignUp={false} forceRedirectUrl="/dashboard" appearance={{ elements: { footerAction: "hidden" }, variables: { colorPrimary: "#b8f49b", colorBackground: "#181b1c", colorForeground: "#edf0ef" } }} />
    </div>
  );
}
