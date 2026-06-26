import dynamic from "next/dynamic";

const CharacterDetailClient = dynamic(
  () => import("../CharacterDetailClient"),
  { ssr: false },
);

export default async function CharacterDetailPage({
  params,
}: {
  params: Promise<{ characterId: string }>;
}) {
  const { characterId } = await params;
  return <CharacterDetailClient characterId={characterId} />;
}
