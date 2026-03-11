import { redirect } from "next/navigation";
import { verifyToken } from "@/lib/auth-store";
import { signSession } from "@/lib/session";
import { cookies } from "next/headers";
import { COOKIE_NAME } from "@/lib/session";

type Props = { searchParams: Promise<{ token?: string }> };

export default async function AuthVerifyPage(props: Props) {
  const searchParams = await props.searchParams;
  const token = searchParams.token;

  if (!token?.trim()) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center px-4">
        <p className="text-zinc-300">This link is invalid. Request a new sign-in link from the app.</p>
        <a href="/" className="mt-4 text-emerald-400 hover:underline">Go to Transcriber</a>
      </div>
    );
  }

  const email = await verifyToken(token);
  if (!email) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center px-4">
        <p className="text-zinc-300">This link has expired or is invalid. Request a new sign-in link.</p>
        <a href="/" className="mt-4 text-emerald-400 hover:underline">Go to Transcriber</a>
      </div>
    );
  }

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, signSession(email), {
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  });

  redirect("/");
}
