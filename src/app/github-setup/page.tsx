import type { Metadata } from "next";
import { GitHubSetup } from "@/components/settings/GitHubSetup";

export const metadata: Metadata = { title: "Set up GitHub · noted-ai" };

export default function GitHubSetupPage() {
  return <GitHubSetup />;
}
