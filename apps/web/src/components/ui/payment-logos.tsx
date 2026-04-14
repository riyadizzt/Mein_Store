/** Payment brand logos — inline SVG + CSS components */

export function VisaLogo({ className = 'h-8' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 60 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="60" height="40" rx="6" fill="#1A1F71" />
      <path d="M24.5 27L27.8 13H32L28.7 27H24.5ZM40.3 13.3C39.3 12.9 37.7 12.5 35.8 12.5C31.8 12.5 29 14.5 29 17.5C28.9 19.7 31 20.8 32.5 21.5C34.1 22.2 34.6 22.7 34.6 23.4C34.6 24.5 33.3 25 32.1 25C30.5 25 29.6 24.7 28.3 24.2L27.8 24L27.3 26.9C28.2 27.3 29.8 27.7 31.5 27.7C35.7 27.7 38.4 25.7 38.5 22.5C38.5 20.8 37.4 19.5 35.3 18.5C33.9 17.8 33 17.3 33 16.6C33 16 33.7 15.3 35.2 15.3C36.5 15.3 37.4 15.6 38.1 15.9L38.4 16L38.8 13.3H40.3ZM48.4 13H45.2C44.2 13 43.5 13.3 43.1 14.3L38.5 27H42.7L43.5 24.7H48.6L49 27H52.7L49.5 13H48.4ZM44.5 22C44.8 21.1 46.2 17.4 46.2 17.4L46.8 15.9 47.1 17.3C47.1 17.3 47.9 21 48.1 22H44.5ZM22.5 13L19.5 23L19.1 21C18.3 18.5 16.1 15.8 13.5 14.5L17.2 27H21.5L26.8 13H22.5Z" fill="white"/>
      <path d="M16.5 13H12L11.9 13.3C16.8 14.5 20 17.5 21.4 21L19.9 14.2C19.7 13.3 19 13 18 13H16.5Z" fill="#F9A51A"/>
    </svg>
  )
}

export function MastercardLogo({ className = 'h-8' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 60 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="60" height="40" rx="6" fill="#fff" stroke="#e5e5e5" />
      <circle cx="23" cy="20" r="12" fill="#EB001B" />
      <circle cx="37" cy="20" r="12" fill="#F79E1B" />
      <path d="M30 11.2a12 12 0 0 0 0 17.6 12 12 0 0 0 0-17.6z" fill="#FF5F00" />
    </svg>
  )
}

export function PayPalLogo({ className = 'h-7' }: { className?: string }) {
  return (
    <div className={`${className} flex items-center`}>
      <span className="text-[15px] font-extrabold italic tracking-tight"><span className="text-[#003087]">Pay</span><span className="text-[#0070BA]">Pal</span></span>
    </div>
  )
}

export function KlarnaLogo({ className = 'h-6' }: { className?: string }) {
  return (
    <div className={`${className} px-3 rounded-md bg-[#FFB3C7] flex items-center`}>
      <span className="text-[#0B051D] text-xs font-extrabold">Klarna.</span>
    </div>
  )
}

export function SumUpLogo({ className = 'h-6' }: { className?: string }) {
  return (
    <div className={`${className} px-3 rounded-md bg-[#1a1a2e] flex items-center`}>
      <span className="text-white text-xs font-bold tracking-wide">SumUp</span>
    </div>
  )
}

export function StripeLogo({ className = 'h-6' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 360 150" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path fillRule="evenodd" clipRule="evenodd" d="M360 77.4C360 51.8 347.6 31.6 323.9 31.6C300.1 31.6 285.7 51.8 285.7 77.2C285.7 107.3 302.7 122.5 327.1 122.5C339 122.5 348 119.8 354.8 116V96C348 99.4 340.2 101.5 330.3 101.5C320.6 101.5 312 98.1 310.9 86.3H359.8C359.8 85 360 79.8 360 77.4ZM310.6 67.9C310.6 56.6 317.5 51.9 323.8 51.9C329.9 51.9 336.4 56.6 336.4 67.9H310.6Z" fill="#635BFF"/>
      <path fillRule="evenodd" clipRule="evenodd" d="M247.1 31.6C237.3 31.6 231 36.2 227.5 39.4L226.2 33.2H204.2V149.8L229.2 144.5L229.3 116.2C232.9 118.8 238.2 122.5 247 122.5C264.9 122.5 281.2 108.1 281.2 76.4C281.1 47.4 264.6 31.6 247.1 31.6ZM241.1 100.5C235.2 100.5 231.7 98.4 229.3 95.8L229.2 58.7C231.8 55.8 235.4 53.8 241.1 53.8C250.2 53.8 256.5 64 256.5 77.1C256.5 90.5 250.3 100.5 241.1 100.5Z" fill="#635BFF"/>
      <path fillRule="evenodd" clipRule="evenodd" d="M169.8 25.7L194.9 20.3V0L169.8 5.3V25.7Z" fill="#635BFF"/>
      <path d="M194.9 33.3H169.8V120.8H194.9V33.3Z" fill="#635BFF"/>
      <path fillRule="evenodd" clipRule="evenodd" d="M142.9 40.7L141.3 33.3H119.7V120.8H144.7V61.5C150.6 53.8 160.6 55.2 163.7 56.3V33.3C160.5 32.1 148.8 29.9 142.9 40.7Z" fill="#635BFF"/>
      <path fillRule="evenodd" clipRule="evenodd" d="M92.9 11.6L68.5 16.8L68.4 96.9C68.4 111.7 79.5 122.6 94.3 122.6C102.5 122.6 108.5 121.1 111.8 119.3V99C108.6 100.3 92.8 104.9 92.8 90.1V54.6H111.8V33.3H92.8L92.9 11.6Z" fill="#635BFF"/>
      <path fillRule="evenodd" clipRule="evenodd" d="M25.3 58.7C25.3 54.8 28.5 53.3 33.8 53.3C41.4 53.3 51 55.6 58.6 59.7V36.2C50.3 32.9 42.1 31.6 33.8 31.6C13.5 31.6 0 42.2 0 59.9C0 87.5 38 83.1 38 95C38 99.6 34 101.1 28.4 101.1C20.1 101.1 9.5 97.7 1.1 93.1V116.9C10.4 120.9 19.8 122.6 28.4 122.6C49.2 122.6 63.5 112.3 63.5 94.4C63.4 64.6 25.3 69.9 25.3 58.7Z" fill="#635BFF"/>
    </svg>
  )
}
