'use client'

export function PasswordStrength({ password }: { password: string }) {
  const checks = [
    password.length >= 8,
    /[A-Z]/.test(password),
    /[0-9]/.test(password),
    /[^A-Za-z0-9]/.test(password),
  ]
  const score = checks.filter(Boolean).length

  if (!password) return null

  const labels = ['Schwach', 'Schwach', 'Mittel', 'Stark', 'Sehr stark']
  const colors = ['bg-red-500', 'bg-red-500', 'bg-orange-500', 'bg-green-500', 'bg-green-600']

  return (
    <div className="space-y-1.5 mt-2">
      <div className="flex gap-1">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={`h-1.5 flex-1 rounded-full ${i < score ? colors[score] : 'bg-muted'}`}
          />
        ))}
      </div>
      <p className={`text-xs ${score <= 1 ? 'text-red-500' : score === 2 ? 'text-orange-500' : 'text-green-600'}`}>
        {labels[score]}
      </p>
    </div>
  )
}
