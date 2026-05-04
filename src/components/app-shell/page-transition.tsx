"use client";

import { motion, AnimatePresence } from "framer-motion";
import { usePathname } from "next/navigation";
import * as React from "react";

/**
 * Subtle fade-up transition between dashboard routes. Uses framer-motion's
 * AnimatePresence keyed on pathname.
 *
 * Kept restrained — flashy transitions are a distraction in an operator
 * dashboard; the goal is "didn't jump" not "wow."
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={pathname}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.15, ease: "easeOut" }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
