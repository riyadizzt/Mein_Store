'use client'

import { useState, useEffect } from 'react'
import { ChevronUp } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'

export function ScrollToTop() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 400)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const scrollUp = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          initial={{ opacity: 0, scale: 0.6, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.6, y: 20 }}
          transition={{ type: 'spring', stiffness: 400, damping: 25 }}
          whileHover={{ scale: 1.1, y: -2 }}
          whileTap={{ scale: 0.9 }}
          onClick={scrollUp}
          aria-label="Scroll to top"
          className="fixed bottom-24 ltr:right-6 rtl:left-6 z-40 h-14 w-14 rounded-full bg-[#d4a853] hover:bg-[#c49b4a] text-black shadow-lg hover:shadow-xl flex items-center justify-center transition-all hover:scale-110"
        >
          <ChevronUp className="h-6 w-6" />
        </motion.button>
      )}
    </AnimatePresence>
  )
}
