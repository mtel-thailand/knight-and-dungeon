"use client";

import dynamic from "next/dynamic";
import { Jersey_25 } from "next/font/google";

const questFont = Jersey_25({ weight: "400", subsets: ["latin"], display: "swap" });

const SpellShopClient = dynamic(() => import("./SpellShopClient"), { ssr: false });

export default function SpellShopPage() {
  return <SpellShopClient />;
}
