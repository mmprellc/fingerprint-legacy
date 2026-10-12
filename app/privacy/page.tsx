import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Privacy" };

export default function PrivacyPage() {
  return (
    <article className="page">
      <p className="kicker">Privacy</p>
      <h1>What this prototype keeps.</h1>
      <div className="stack">
        <p>A fingerprint photograph and the words you type are stored on the server so the order can be printed and downloaded. They are not sold and they are not used to train anything.</p>
        <p>Payment details, when Stripe is connected, are collected by Stripe. This app stores the email, the shipping address, and the order status.</p>
        <p>The owner dashboard is locked with a password. Order links are unguessable, and anyone with a link can download that order’s files.</p>
        <p><Link href="/studio">Return to the studio</Link></p>
      </div>
    </article>
  );
}
