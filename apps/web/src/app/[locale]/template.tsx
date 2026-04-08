'use client'

import { motion } from 'motion/react'

/**
 * Page transition template — Next.js re-renders template.tsx on every
 * route navigation (unlike layout.tsx which persists). This gives us
 * a clean fade-in on every page change.
 *
 * Using motion for smooth, GPU-accelerated opacity + translateY.
 * Respects prefers-reduced-motion via motion's built-in support.
 */
export default function PageTransitionTemplate({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
    >
      {children}
    </motion.div>
  )
}
