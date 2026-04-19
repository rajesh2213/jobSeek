import type { Metadata } from "next";
import { AccountDashboard } from "../../../components/account/AccountDashboard";

export const metadata: Metadata = {
  title: "Account | JobLoom",
};

export default function AccountPage() {
  return <AccountDashboard />;
}
