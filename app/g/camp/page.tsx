import { Suspense } from "react";
import CampClient from "./CampClient";

export default function CampPage() {
  return (
    <Suspense fallback={<div className="camp-page"><div className="camp-body"><div className="camp-center-msg"><div className="camp-spinner" /><span>Loading…</span></div></div></div>}>
      <CampClient />
    </Suspense>
  );
}
