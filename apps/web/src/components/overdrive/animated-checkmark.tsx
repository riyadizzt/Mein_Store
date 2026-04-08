'use client'

import { motion } from 'motion/react'

/**
 * Animated success checkmark — motion-powered with spring physics.
 * Replaces a Lottie file with a lightweight, themeable SVG animation.
 *
 * Sequence: circle scales in → ring draws → checkmark draws → pulse glow
 */
export function AnimatedCheckmark({ size = 112, delay = 0 }: { size?: number; delay?: number }) {
  const r = size / 2 - 4 // circle radius
  const circumference = 2 * Math.PI * r
  const center = size / 2

  return (
    <motion.div
      initial={{ scale: 0 }}
      animate={{ scale: 1 }}
      transition={{
        type: 'spring',
        stiffness: 260,
        damping: 20,
        delay,
      }}
      className="relative inline-flex items-center justify-center"
    >
      {/* Glow pulse behind */}
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: [0, 0.3, 0], scale: [0.8, 1.3, 1.5] }}
        transition={{ duration: 1.5, delay: delay + 0.5, ease: 'easeOut' }}
        className="absolute inset-0 rounded-full bg-green-400"
        style={{ width: size, height: size }}
      />

      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        fill="none"
        className="relative z-10"
      >
        {/* Background circle */}
        <motion.circle
          cx={center}
          cy={center}
          r={r}
          fill="#dcfce7"
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{
            type: 'spring',
            stiffness: 300,
            damping: 25,
            delay,
          }}
          style={{ transformOrigin: 'center' }}
        />

        {/* Ring stroke — draws in */}
        <motion.circle
          cx={center}
          cy={center}
          r={r}
          stroke="#16a34a"
          strokeWidth={2.5}
          strokeLinecap="round"
          fill="none"
          initial={{ strokeDasharray: circumference, strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: 0 }}
          transition={{ duration: 0.7, delay: delay + 0.2, ease: [0.4, 0, 0.2, 1] }}
        />

        {/* Checkmark path — draws in */}
        <motion.path
          d={`M${center * 0.56} ${center * 1.02} L${center * 0.88} ${center * 1.3} L${center * 1.44} ${center * 0.7}`}
          stroke="#16a34a"
          strokeWidth={3.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{
            pathLength: {
              duration: 0.4,
              delay: delay + 0.6,
              ease: [0.65, 0, 0.35, 1],
            },
            opacity: { duration: 0.01, delay: delay + 0.6 },
          }}
        />
      </svg>
    </motion.div>
  )
}
