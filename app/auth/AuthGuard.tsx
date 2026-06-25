"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";
import { auth, onAuthStateChanged, signOut as fbSignOut } from "@/lib/firebase-client";
import type { User } from "@/lib/firebase-client";

type AuthCtx = {
  user: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthCtx>({ user: null, loading: true, signOut: async () => {} });

export function useAuth() {
  return useContext(AuthContext);
}

const PUBLIC_ROUTES = ["/auth/login"];

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (loading) return;
    if (!user && !PUBLIC_ROUTES.includes(pathname)) {
      router.replace("/auth/login");
    }
  }, [user, loading, pathname, router]);

  const signOut = async () => {
    await fbSignOut(auth);
    router.replace("/auth/login");
  };

  return (
    <AuthContext.Provider value={{ user, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
