'use client'

import { motion } from 'motion/react'

/**
 * Account template — re-renders on every sub-route navigation,
 * providing a smooth fade-slide transition between account pages.
 */
export default function AccountTemplate({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  )
}
