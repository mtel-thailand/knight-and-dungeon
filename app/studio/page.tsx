"use client";

import { useEffect } from "react";
import { useAuth } from "@/app/auth/AuthGuard";
import StudioClient from "./StudioClient";

export default function StudioPage() {
  const { user } = useAuth();
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__studioUserId = user?.uid ?? null;
  }, [user]);
  return <StudioClient />;
}
