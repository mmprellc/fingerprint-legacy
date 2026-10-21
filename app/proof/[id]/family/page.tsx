import type { Metadata } from "next";
import { getDesign } from "@/lib/store";
import { FamilyComment } from "./family-comment";

export const metadata: Metadata = { title: "Family proof" };
export const dynamic = "force-dynamic";

export default async function FamilyProofPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const token = typeof query.token === "string" ? query.token : "";
  const design = await getDesign(id);
  if (!design || !token || token !== design.shareToken) {
    return (
      <article className="page">
        <h1>This family link is not valid.</h1>
        <p className="lede">Ask for a new link from the person who made the portrait.</p>
      </article>
    );
  }
  const approved = design.versions?.find((item) => item.number === design.approvedVersion);
  const version = approved ?? design.versions?.at(-1);
  const number = version?.number ?? 1;
  return (
    <article className="page">
      <p className="kicker">Family</p>
      <h1>{design.style.headerName || "A portrait"}</h1>
      <p className="lede">You can look at the proof and leave a comment. Ordering stays with the person who made it.</p>
      {approved ? <p className="note">Approved: Version {approved.number}</p> : <p className="note">This proof is not approved yet.</p>}
      <img src={`/api/designs/${design.id}/asset/v${number}.png`} alt="Shared proof" />
      <ul>
        {(design.comments ?? []).map((comment) => (
          <li key={comment.id}><strong>{comment.author}</strong> {comment.text}</li>
        ))}
      </ul>
      <FamilyComment id={design.id} token={token} />
    </article>
  );
}
