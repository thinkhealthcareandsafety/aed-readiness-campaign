import { headers } from "next/headers";
import AuditWizard from "@/components/AuditWizard";
import { getFormSchema } from "@/lib/db";
import { detectCityFromIp, getClientIp } from "@/lib/geoCity";

export const dynamic = "force-dynamic";

export default async function Home() {
  const schema = await getFormSchema();
  const headersList = await headers();
  const detectedCity = await detectCityFromIp(getClientIp(headersList));
  return <AuditWizard schema={schema} detectedCity={detectedCity} />;
}
