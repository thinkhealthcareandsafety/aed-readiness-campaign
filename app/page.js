import AuditWizard from "@/components/AuditWizard";
import Landing from "@/components/Landing";
import { getFormSchema } from "@/lib/db";

export const dynamic = "force-dynamic";

export default function Home() {
  const schema = getFormSchema();
  return (
    <>
      <Landing />
      <AuditWizard schema={schema} />
    </>
  );
}
