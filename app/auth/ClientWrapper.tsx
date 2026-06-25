"use client";

import { ReactNode } from "react";
import { AuthProvider } from "./AuthGuard";

export default function ClientWrapper({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}
