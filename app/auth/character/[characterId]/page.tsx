"use client";

import dynamic from "next/dynamic";

const CharacterDetailClient = dynamic(
  () => import("../CharacterDetailClient"),
  { ssr: false },
);

export default function CharacterDetailPage({
  params,
}: {
  params: { characterId: string };
}) {
  return <CharacterDetailClient characterId={params.characterId} />;
}
