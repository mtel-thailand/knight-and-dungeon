"use client";

import dynamic from "next/dynamic";

const CharacterShopClient = dynamic(
  () => import("./CharacterShopClient"),
  { ssr: false },
);

export default function CharacterShopPage() {
  return <CharacterShopClient />;
}
