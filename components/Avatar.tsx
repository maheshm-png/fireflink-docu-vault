"use client";

import { useState } from "react";
import { gravatarUrl } from "@/lib/gravatar";

/**
 * Profile picture with a graceful fallback to the existing initials-circle
 * look. Tries the account's Gravatar first (lib/gravatar.ts) — see that
 * file's own comment for why that's the photo source used here rather than
 * an actual Google Workspace photo. Falls back the moment the image 404s
 * (no Gravatar set up for that address), so most people just see the same
 * initials circle they always did.
 */
export default function Avatar({
  name,
  email,
  size = 32,
  className = "",
}: {
  name: string;
  email: string;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (failed || !email) {
    return (
      <span
        className={`flex shrink-0 items-center justify-center rounded-full bg-ff-lavender font-semibold uppercase text-ff-accent ${className}`}
        style={{ width: size, height: size, fontSize: size * 0.4 }}
      >
        {name.charAt(0)}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- external, unoptimizable Gravatar URL
    <img
      src={gravatarUrl(email, size * 2)}
      alt={name}
      width={size}
      height={size}
      onError={() => setFailed(true)}
      className={`shrink-0 rounded-full object-cover ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
