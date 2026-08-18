import AuditWizard from "@/components/AuditWizard";
import { getFormSchema } from "@/lib/db";

export const dynamic = "force-dynamic";

export default function Home() {
  const schema = getFormSchema();
  return <AuditWizard schema={schema} />;
}
