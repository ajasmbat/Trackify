import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

// Auth.js v5 with a single-operator Credentials provider. `CONSOLE_USERNAME`
// and `CONSOLE_PASSWORD` are read at request time (not import time) so a
// developer editing .env doesn't need to restart the whole app.
//
// The console is an internal operator UI — one operator, one credential. When
// the project grows a real team, swap the provider (GitHub / Google / SSO)
// without touching the rest of the app: the layout consumes `auth()` and
// nothing else.

function envUsername(): string {
  const v = process.env.CONSOLE_USERNAME;
  if (!v || v.length === 0) throw new Error("CONSOLE_USERNAME is required");
  return v;
}

function envPassword(): string {
  const v = process.env.CONSOLE_PASSWORD;
  if (!v || v.length === 0) throw new Error("CONSOLE_PASSWORD is required");
  return v;
}

export const { auth, handlers, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/signin" },
  providers: [
    Credentials({
      name: "operator",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      authorize(raw) {
        const username = typeof raw?.username === "string" ? raw.username : "";
        const password = typeof raw?.password === "string" ? raw.password : "";
        if (username === envUsername() && password === envPassword()) {
          return { id: "operator", name: username };
        }
        return null;
      },
    }),
  ],
});
