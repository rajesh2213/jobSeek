"use client";

import type { CSSProperties } from "react";
import Link from "next/link";

const fixedFrame: CSSProperties = {
  position: "fixed",
  top: 10,
  right: 76,
  left: "auto",
  bottom: "auto",
};

export function FixedGetProButton() {
  return (
    <Link
      href="/pricing"
      style={fixedFrame}
      className="z-[100] inline-flex h-11 items-center rounded-full bg-brand px-4 text-sm font-bold !text-white no-underline shadow-sm transition-colors visited:!text-white hover:bg-brand-hover hover:!text-white active:!text-white"
    >
      Get Pro
    </Link>
  );
}
