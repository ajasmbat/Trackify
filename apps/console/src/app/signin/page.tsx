import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";

interface Props {
  searchParams: { callbackUrl?: string; error?: string };
}

export default async function SignInPage({ searchParams }: Props) {
  const session = await auth();
  if (session) redirect(searchParams.callbackUrl ?? "/");

  async function signInAction(formData: FormData) {
    "use server";
    const username = String(formData.get("username") ?? "");
    const password = String(formData.get("password") ?? "");
    const callbackUrl = String(formData.get("callbackUrl") ?? "/");
    await signIn("credentials", { username, password, redirectTo: callbackUrl });
  }

  return (
    <main
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        minHeight: "100vh",
        fontFamily: "system-ui",
        background: "#0b0d10",
        color: "#e4e6eb",
      }}
    >
      <form
        action={signInAction}
        style={{
          background: "#151a20",
          padding: "2rem",
          borderRadius: 12,
          width: 320,
          boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
        }}
      >
        <h1 style={{ marginTop: 0, marginBottom: "0.25rem" }}>Trackify</h1>
        <p style={{ marginTop: 0, opacity: 0.7, fontSize: 14 }}>
          Operator console — sign in
        </p>
        <input
          type="hidden"
          name="callbackUrl"
          value={searchParams.callbackUrl ?? "/"}
        />
        <label style={label}>
          Username
          <input name="username" required autoComplete="username" style={input} />
        </label>
        <label style={label}>
          Password
          <input
            name="password"
            type="password"
            required
            autoComplete="current-password"
            style={input}
          />
        </label>
        {searchParams.error ? (
          <p style={{ color: "#ff6b6b", fontSize: 13, marginTop: "-0.5rem" }}>
            Invalid credentials.
          </p>
        ) : null}
        <button type="submit" style={button}>
          Sign in
        </button>
      </form>
    </main>
  );
}

const label: React.CSSProperties = {
  display: "block",
  marginTop: "1rem",
  fontSize: 13,
  opacity: 0.8,
};

const input: React.CSSProperties = {
  display: "block",
  width: "100%",
  marginTop: 4,
  padding: "0.55rem 0.75rem",
  background: "#0b0d10",
  border: "1px solid #2a323d",
  borderRadius: 6,
  color: "#e4e6eb",
  fontSize: 14,
  boxSizing: "border-box",
};

const button: React.CSSProperties = {
  marginTop: "1.25rem",
  width: "100%",
  padding: "0.65rem",
  background: "#3a72ff",
  border: 0,
  borderRadius: 6,
  color: "#fff",
  fontWeight: 600,
  fontSize: 14,
  cursor: "pointer",
};
