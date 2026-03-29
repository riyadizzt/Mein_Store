'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'

interface Tab {
  id: string
  label: string
  content: React.ReactNode
}

interface ProductTabsProps {
  tabs: Tab[]
}

export function ProductTabs({ tabs }: ProductTabsProps) {
  const [activeTab, setActiveTab] = useState(tabs[0]?.id ?? '')

  return (
    <>
      {/* Desktop: Tabs */}
      <div className="hidden sm:block">
        <div className="border-b flex gap-0">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="py-6">
          {tabs.find((t) => t.id === activeTab)?.content}
        </div>
      </div>

      {/* Mobile: Accordion */}
      <div className="sm:hidden divide-y">
        {tabs.map((tab) => (
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
    </>
  )
}

function AccordionItem({
  label, isOpen, onToggle, children,
}: {
  label: string; isOpen: boolean; onToggle: () => void; children: React.ReactNode
}) {
  return (
    <div>
      <button
        onClick={onToggle}
        className="flex items-center justify-between w-full py-4 text-sm font-medium"
      >
        {label}
        <ChevronDown
          className={`h-4 w-4 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>
      {isOpen && <div className="pb-4">{children}</div>}
    </div>
  )
}
