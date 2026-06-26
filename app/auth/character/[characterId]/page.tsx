"use client";

import dynamic from "next/dynamic";
import { use } from "react";

const CharacterDetailClient = dynamic(
  () => import("../CharacterDetailClient"),
  { ssr: false },
);

export default function CharacterDetailPage({
  params,
}: {
  params: Promise<{ characterId: string }>;
}) {
  const { characterId } = use(params);
  return <CharacterDetailClient characterId={characterId} />;
}
