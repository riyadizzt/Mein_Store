'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { motion, AnimatePresence } from 'motion/react'

interface Tab {
  id: string
  label: string
  content: React.ReactNode
}

interface PremiumTabsProps {
  tabs: Tab[]
  defaultTab?: string
}

export function PremiumTabs({ tabs, defaultTab }: PremiumTabsProps) {
  const [activeTab, setActiveTab] = useState(defaultTab ?? tabs[0]?.id ?? '')

  return (
    <div>
      {/* ─── Desktop: Horizontal Tabs ─── */}
      <div className="hidden md:block">
        <div className="flex border-b border-[#e5e5e5]">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`relative px-0 py-4 text-[13px] tracking-[0.08em] uppercase transition-colors ${
                tabs.indexOf(tab) > 0 ? 'ltr:ml-10 rtl:mr-10' : ''
              } ${activeTab === tab.id ? 'text-[#0f1419]' : 'text-[#0f1419]/30 hover:text-[#0f1419]/50'}`}
            >
              {tab.label}
              {activeTab === tab.id && (
                <motion.div
                  layoutId="premium-tab-indicator"
                  className="absolute bottom-0 left-0 right-0 h-px bg-[#0f1419]"
                  transition={{ type: 'spring', stiffness: 400, damping: 35 }}
                />
              )}
            </button>
          ))}
        </div>
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
            className="py-10"
          >
            {tabs.find(t => t.id === activeTab)?.content}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* ─── Mobile: Accordion ─── */}
      <div className="md:hidden divide-y divide-[#e5e5e5] border-b border-[#e5e5e5]">
        {tabs.map(tab => (
          <AccordionItem
            key={tab.id}
            label={tab.label}
            isOpen={activeTab === tab.id}
            onToggle={() => setActiveTab(activeTab === tab.id ? '' : tab.id)}
          >
            {tab.content}
          </AccordionItem>
        ))}
      </div>
    </div>
  )
}

function AccordionItem({ label, isOpen, onToggle, children }: {
  label: string; isOpen: boolean; onToggle: () => void; children: React.ReactNode
}) {
  return (
    <div>
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between py-5 text-[13px] tracking-[0.08em] uppercase text-[#0f1419]"
      >
        {label}
        <ChevronDown
          className={`h-4 w-4 text-[#0f1419]/30 transition-transform duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)] ${isOpen ? 'rotate-180' : ''}`}
          strokeWidth={1.5}
        />
      </button>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
            className="overflow-hidden"
          >
            <div className="pb-8">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
