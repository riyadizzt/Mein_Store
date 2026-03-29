'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Mail, Phone, MapPin, Clock, Send, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export default function ContactPage() {
  const t = useTranslations('contact')
  const [sent, setSent] = useState(false)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setSent(true)
  }

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12 sm:py-20">
      <div className="text-center mb-12 animate-fade-up">
        <h1 className="text-3xl sm:text-4xl font-bold mb-3">{t('title')}</h1>
        <p className="text-muted-foreground max-w-md mx-auto">{t('subtitle')}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-12 max-w-5xl mx-auto">
        {/* Info */}
        <div className="lg:col-span-2 space-y-6 animate-fade-up delay-100">
          {[
            { Icon: Mail, label: t('email'), value: 'info@malak-bekleidung.com' },
            { Icon: Phone, label: t('phone'), value: '+49 (0) 30 123 456 78' },
            { Icon: MapPin, label: t('address'), value: 'Berlin, Deutschland' },
            { Icon: Clock, label: t('hours'), value: t('hoursValue') },
          ].map(({ Icon, label, value }) => (
            <div key={label} className="flex items-start gap-4 group">
              <div className="h-11 w-11 rounded-xl bg-accent/10 flex items-center justify-center flex-shrink-0 transition-all duration-300 group-hover:bg-accent/20 group-hover:scale-105">
                <Icon className="h-5 w-5 text-accent" />
              </div>
              <div>
                <p className="text-sm font-semibold">{label}</p>
                <p className="text-sm text-muted-foreground">{value}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Form */}
        <div className="lg:col-span-3 animate-fade-up delay-200">
          {sent ? (
            <div className="text-center py-16 animate-scale-in">
              <CheckCircle2 className="h-16 w-16 mx-auto mb-4 text-green-500" />
              <h3 className="text-xl font-bold mb-2">{t('sent')}</h3>
              <p className="text-muted-foreground">{t('sentMessage')}</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5 bg-background border rounded-2xl p-6 sm:p-8">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium mb-1.5 block">{t('name')}</label>
                  <Input required className="h-11" />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">{t('emailField')}</label>
                  <Input type="email" required className="h-11" />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">{t('subject')}</label>
                <Input required className="h-11" />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">{t('message')}</label>
                <textarea required rows={5} className="w-full px-3 py-2.5 rounded-xl border bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring/20" />
              </div>
              <Button type="submit" size="lg" className="w-full gap-2 btn-press">
                <Send className="h-4 w-4" /> {t('send')}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
