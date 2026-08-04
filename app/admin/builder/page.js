import { redirect } from "next/navigation";
import Link from "next/link";
import { isAdminAuthed } from "@/lib/adminAuth";
import { getFormSchema } from "@/lib/db";
import FormBuilder from "@/components/FormBuilder";

export const dynamic = "force-dynamic";

export default async function BuilderPage() {
  const authed = await isAdminAuthed();
  if (!authed) redirect("/admin/login");

  const schema = getFormSchema();

  return (
    <>
      <div style={{ maxWidth: 980, margin: "0 auto", padding: "20px clamp(16px, 4vw, 40px) 0" }}>
        <Link href="/admin">&larr; Back to submissions</Link>
      </div>
      <FormBuilder initialSchema={schema} />
    </>
  );
}
